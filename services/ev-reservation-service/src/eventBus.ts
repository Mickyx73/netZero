import amqplib, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";

// Shared event-bus wrapper used by every NetZero Hub microservice that
// participates in asynchronous choreography (Part C: async ServiceContracts
// carry a second, consumer-facing interface -> here, that interface is
// realised as a topic-exchange event rather than a callback URL).
//
// Exchange: "netzero.events" (topic)
// Routing keys used in this system:
//   ev.session.ended        -> published by ev-reservation-service
//   ev.billing.settled      -> published by ev-billing-service
//   offset.requested        -> published by offset-service
//   offset.certified        -> published by offset-service
//   offset.failed           -> published by offset-service
//
// Resilience (a broker restart or network blip must not lose business events):
//   - the connection is re-established automatically, with back-off;
//   - every subscription is re-declared and re-bound after a reconnect;
//   - publishes use a confirm channel, so a message only counts as sent once
//     RabbitMQ has accepted it;
//   - a publish that fails is kept in an in-memory outbox and retried in order
//     once the broker is back. (A production system would persist this outbox
//     in the service's own database -- the "transactional outbox" pattern -- so
//     it also survives a restart of the service itself.)

const EXCHANGE = "netzero.events";
const AMQP_URL = process.env.AMQP_URL || "amqp://localhost:5672";

type Handler = (payload: any) => Promise<void> | void;
interface Subscription {
  pattern: string;
  queue: string;
  handler: Handler;
  boundTo?: ConfirmChannel;
}

let model: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;
let connecting: Promise<ConfirmChannel> | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelay = 1000;
const subscriptions: Subscription[] = [];
const outbox: Array<{ routingKey: string; payload: unknown }> = [];

function dropConnection(reason: string) {
  if (!channel && !model) return;
  console.warn(`[eventBus] connection lost (${reason}); reconnecting`);
  const old = model;
  channel = null;
  model = null;
  old?.close().catch(() => {});
  scheduleReconnect();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connect();
      console.log("[eventBus] connected to broker");
      reconnectDelay = 1000;
    } catch (err) {
      console.error(`[eventBus] reconnect failed: ${(err as Error).message}; retrying in ${reconnectDelay / 1000}s`);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      scheduleReconnect();
    }
  }, reconnectDelay);
}

async function bind(ch: ConfirmChannel, sub: Subscription) {
  if (sub.boundTo === ch) return;
  const q = await ch.assertQueue(sub.queue, { durable: true });
  await ch.bindQueue(q.queue, EXCHANGE, sub.pattern);
  await ch.consume(q.queue, async (msg: ConsumeMessage | null) => {
    if (!msg) return;
    try {
      await sub.handler(JSON.parse(msg.content.toString()));
      ch.ack(msg);
    } catch (err) {
      console.error(`[eventBus] handler error for ${sub.pattern}:`, (err as Error).message);
      // Requeue once (a transient failure), drop on the second failure (a poison message).
      try { ch.nack(msg, false, !msg.fields.redelivered); } catch { /* channel already closed */ }
    }
  });
  sub.boundTo = ch;
  console.log(`[eventBus] subscribed queue "${sub.queue}" to "${sub.pattern}"`);
}

async function connect(): Promise<ConfirmChannel> {
  if (channel) return channel;
  if (connecting) return connecting;
  connecting = (async () => {
    const m = await amqplib.connect(AMQP_URL, { heartbeat: 10 });
    m.on("error", (err) => console.error("[eventBus] connection error:", err.message));
    m.on("close", () => { if (model === m) dropConnection("connection closed"); });
    const ch = await m.createConfirmChannel();
    ch.on("close", () => { if (channel === ch) dropConnection("channel closed"); });
    await ch.assertExchange(EXCHANGE, "topic", { durable: true });
    model = m;
    channel = ch;
    for (const sub of subscriptions) await bind(ch, sub);
    void flushOutbox();
    return ch;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function publishNow(routingKey: string, payload: unknown) {
  const ch = await connect();
  await new Promise<void>((resolve, reject) =>
    ch.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), { contentType: "application/json", persistent: true }, (err) =>
      err ? reject(err) : resolve()
    )
  );
  console.log(`[eventBus] published ${routingKey}`, payload);
}

let flushing = false;
async function flushOutbox() {
  if (flushing || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      await publishNow(outbox[0].routingKey, outbox[0].payload);
      outbox.shift();
    }
    console.log("[eventBus] outbox drained");
  } catch {
    scheduleReconnect();
  } finally {
    flushing = false;
  }
}

/** Publishes an event. If the broker is unreachable it is queued and delivered, in order, once it is back. */
export async function publishEvent(routingKey: string, payload: unknown): Promise<void> {
  if (outbox.length) {
    outbox.push({ routingKey, payload }); // keep ordering behind earlier undelivered events
    void flushOutbox();
    return;
  }
  try {
    await publishNow(routingKey, payload);
  } catch (err) {
    console.error(`[eventBus] publish of ${routingKey} failed (${(err as Error).message}); held in outbox for retry`);
    outbox.push({ routingKey, payload });
    scheduleReconnect();
  }
}

/** Subscribes a durable queue to a routing-key pattern; survives broker restarts. */
export async function subscribeEvent(routingKeyPattern: string, queueName: string, handler: Handler): Promise<void> {
  const sub: Subscription = { pattern: routingKeyPattern, queue: queueName, handler };
  subscriptions.push(sub);
  try {
    const ch = await connect();
    await bind(ch, sub);
  } catch (err) {
    console.error(`[eventBus] broker not reachable yet (${(err as Error).message}); will subscribe once connected`);
    scheduleReconnect();
  }
}

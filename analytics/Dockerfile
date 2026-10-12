FROM python:3.12-slim
# graphviz renders the discovered models (pm4py visualisations)
RUN apt-get update && apt-get install -y --no-install-recommends graphviz && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mine.py .
CMD ["python", "mine.py"]

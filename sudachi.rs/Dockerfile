# Use the official Python image, with Python 3.11
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install dependencies and Rust, and build Sudachi.rs
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    && curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh -s -- -y \
    && git clone https://github.com/WorksApplications/sudachi.rs.git \
    && cd sudachi.rs \
    && . $HOME/.cargo/env \
    && cargo build --release \
    && cargo install --path sudachi-cli/ \
    && ./fetch_dictionary.sh

# Copy local code to the container image
COPY . .

RUN pip install -r requirements.txt

CMD ["uvicorn", "main:app", "--host=0.0.0.0", "--port=8000"]



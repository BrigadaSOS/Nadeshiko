FROM golang:1.24 AS builder

WORKDIR /src

# Install ocb
RUN go install go.opentelemetry.io/collector/cmd/builder@v0.143.0

# Copy builder config and local processor
COPY builder-config.yaml .
COPY headerinjector/ ./headerinjector/

# Build the collector
RUN CGO_ENABLED=1 builder --config=builder-config.yaml --output-path=./build

# Find and collect the symbolic-go shared library needed at runtime
RUN find / -name "libsymbolic_cabi.so" 2>/dev/null -exec cp {} /src/build/ \;

# Runtime image: distroless/cc required by symbolicator (CGO/glibc)
FROM gcr.io/distroless/cc-debian12

COPY --from=builder /src/build/otelcol-browser /otelcol
COPY --from=builder /src/build/libsymbolic_cabi.so /usr/lib/

ENTRYPOINT ["/otelcol"]
CMD ["--config=/etc/otelcol/config.yaml"]

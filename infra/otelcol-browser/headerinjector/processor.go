package headerinjector

import (
	"context"
	"strings"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"
)

type headerInjectorProcessor struct {
	cfg    *Config
	logger *zap.Logger
}

func newProcessor(cfg *Config, logger *zap.Logger) *headerInjectorProcessor {
	return &headerInjectorProcessor{cfg: cfg, logger: logger}
}

func (p *headerInjectorProcessor) extractValues(ctx context.Context) map[string]string {
	info := client.FromContext(ctx)
	attrs := make(map[string]string)

	// Debug: log all available metadata keys
	var keys []string
	for key := range info.Metadata.Keys() {
		keys = append(keys, key)
	}
	p.logger.Debug("headerinjector metadata", zap.Strings("keys", keys), zap.Int("header_count", len(keys)))

	for _, mapping := range p.cfg.Headers {
		vals := info.Metadata.Get(mapping.Header)
		if len(vals) == 0 {
			p.logger.Debug("header not found in metadata", zap.String("header", mapping.Header))
			continue
		}
		value := vals[0]
		if mapping.ExtractEdgePop {
			if idx := strings.LastIndex(value, "-"); idx >= 0 {
				value = value[idx+1:]
			}
		}
		if value != "" {
			attrs[mapping.Attribute] = value
		}
	}

	return attrs
}

func setResourceAttrs(resource pcommon.Resource, attrs map[string]string) {
	for k, v := range attrs {
		resource.Attributes().PutStr(k, v)
	}
}

func (p *headerInjectorProcessor) processTraces(ctx context.Context, td ptrace.Traces) (ptrace.Traces, error) {
	attrs := p.extractValues(ctx)
	if len(attrs) == 0 {
		return td, nil
	}
	for i := 0; i < td.ResourceSpans().Len(); i++ {
		setResourceAttrs(td.ResourceSpans().At(i).Resource(), attrs)
	}
	return td, nil
}

func (p *headerInjectorProcessor) processMetrics(ctx context.Context, md pmetric.Metrics) (pmetric.Metrics, error) {
	attrs := p.extractValues(ctx)
	if len(attrs) == 0 {
		return md, nil
	}
	for i := 0; i < md.ResourceMetrics().Len(); i++ {
		setResourceAttrs(md.ResourceMetrics().At(i).Resource(), attrs)
	}
	return md, nil
}

func (p *headerInjectorProcessor) processLogs(ctx context.Context, ld plog.Logs) (plog.Logs, error) {
	attrs := p.extractValues(ctx)
	if len(attrs) == 0 {
		return ld, nil
	}
	for i := 0; i < ld.ResourceLogs().Len(); i++ {
		setResourceAttrs(ld.ResourceLogs().At(i).Resource(), attrs)
	}
	return ld, nil
}

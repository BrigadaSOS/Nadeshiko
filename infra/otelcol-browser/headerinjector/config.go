package headerinjector

// HeaderMapping defines a mapping from an HTTP header to an OTLP resource attribute.
type HeaderMapping struct {
	// Header is the HTTP header name to read (case-insensitive).
	Header string `mapstructure:"header"`

	// Attribute is the OTLP resource attribute key to set.
	Attribute string `mapstructure:"attribute"`

	// ExtractEdgePop extracts the Cloudflare PoP code from a cf-ray value.
	// cf-ray format: "8f1a2b3c4d5e6f7g-NRT" -> extracts "NRT".
	ExtractEdgePop bool `mapstructure:"extract_edge_pop"`
}

// Config defines the configuration for the headerinjector processor.
type Config struct {
	// Headers is the list of header-to-attribute mappings.
	Headers []HeaderMapping `mapstructure:"headers"`
}

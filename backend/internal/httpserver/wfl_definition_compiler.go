package httpserver

import (
	"encoding/json"

	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
)

// wflDefinitionCompiler keeps DCL dependent on its compiler port while the
// application composition layer supplies WFL's concrete script compiler.
type wflDefinitionCompiler struct{}

func (wflDefinitionCompiler) Compile(script string) (code string, diagnostic *string, compiled []byte, err error) {
	definition, compileErr := wfldomain.CompileDefinitionScript(script)
	if compileErr != nil {
		message := compileErr.Error()
		return "", &message, nil, compileErr
	}

	encoded, jsonErr := json.Marshal(definition)
	if jsonErr != nil {
		return "", nil, nil, jsonErr
	}
	return definition.Code, nil, encoded, nil
}

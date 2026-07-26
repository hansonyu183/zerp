package wfl

import (
	"context"
	"strings"
)

func (s *Service) Action(ctx context.Context, action string, input ActionInput, actorID, requestID string) (any, error) {
	if strings.HasSuffix(action, "-get") {
		return s.getStage(ctx, action, input)
	}
	if !validID(input.ProcessID) || input.ProcessRevision < 1 || !validID(actorID) {
		return nil, validation("invalid workflow action", nil)
	}
	switch action {
	case "check", "uncheck", "approve", "unapprove", "short-close-request", "short-close-cancel",
		"short-close-confirm", "short-close-unconfirm":
		return s.rootAction(ctx, action, input, actorID, requestID)
	}
	parts := strings.SplitN(action, "-", 2)
	if len(parts) != 2 {
		return nil, validation("invalid workflow action", nil)
	}
	stage := map[string]string{"procurement": StageProcurement, "receipt": StageReceipt,
		"delivery": StageDelivery, "signoff": StageSignoff}[parts[0]]
	if stage == "" {
		return nil, validation("invalid workflow stage", nil)
	}
	return s.stageAction(ctx, stage, parts[1], input, actorID, requestID)
}

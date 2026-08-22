FROM golang:1.26-alpine AS build

ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

WORKDIR /src

COPY go.mod go.sum ./
COPY tools/go.mod tools/go.sum ./tools/
RUN go mod download \
    && go -C tools mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-cleanup-vou-attachments ./cmd/cleanup-vou-attachments
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-bootstrap-admin ./cmd/bootstrap-admin
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-seed-bob ./cmd/seed-bob
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-seed-production-demo ./cmd/seed-production-demo
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-seed-test ./cmd/seed-test
RUN go -C tools build -trimpath -ldflags="-s -w" -o /out/goose github.com/pressly/goose/v3/cmd/goose

FROM alpine:3.23

RUN apk add --no-cache ca-certificates \
    && addgroup -S zerp \
    && adduser -S -G zerp zerp \
    && mkdir -p /var/lib/zerp/attachments \
    && chown -R zerp:zerp /var/lib/zerp

COPY --from=build /out/zerp-server /usr/local/bin/zerp-server
COPY --from=build /out/zerp-cleanup-vou-attachments /usr/local/bin/zerp-cleanup-vou-attachments
COPY --from=build /out/zerp-bootstrap-admin /usr/local/bin/zerp-bootstrap-admin
COPY --from=build /out/zerp-seed-bob /usr/local/bin/zerp-seed-bob
COPY --from=build /out/zerp-seed-production-demo /usr/local/bin/zerp-seed-production-demo
COPY --from=build /out/zerp-seed-test /usr/local/bin/zerp-seed-test
COPY --from=build /out/goose /usr/local/bin/goose
COPY db/migrations /app/migrations
RUN chmod -R a+rX /app/migrations

USER zerp
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/zerp-server"]

FROM golang:1.26-alpine AS build

ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-cleanup-attachments ./cmd/cleanup-attachments
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-bootstrap-admin ./cmd/bootstrap-admin
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-seed-bob ./cmd/seed-bob
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-seed-production-demo ./cmd/seed-production-demo
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-seed-test ./cmd/seed-test
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-rpt-validate-published ./cmd/rpt-validate-published

FROM alpine:3.23

RUN apk add --no-cache ca-certificates \
    && addgroup -S zerp \
    && adduser -S -G zerp zerp \
    && mkdir -p /var/lib/zerp/attachments \
    && chown -R zerp:zerp /var/lib/zerp

COPY --from=build /out/zerp-server /usr/local/bin/zerp-server
COPY --from=build /out/zerp-cleanup-attachments /usr/local/bin/zerp-cleanup-attachments
COPY --from=build /out/zerp-bootstrap-admin /usr/local/bin/zerp-bootstrap-admin
COPY --from=build /out/zerp-seed-bob /usr/local/bin/zerp-seed-bob
COPY --from=build /out/zerp-seed-production-demo /usr/local/bin/zerp-seed-production-demo
COPY --from=build /out/zerp-seed-test /usr/local/bin/zerp-seed-test
COPY --from=build /out/zerp-rpt-validate-published /usr/local/bin/zerp-rpt-validate-published
USER zerp
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/zerp-server"]

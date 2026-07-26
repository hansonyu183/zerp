FROM golang:1.26-alpine AS build

ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/zerp-cleanup-vou-attachments ./cmd/cleanup-vou-attachments

FROM alpine:3.23

RUN apk add --no-cache ca-certificates \
    && addgroup -S zerp \
    && adduser -S -G zerp zerp \
    && mkdir -p /var/lib/zerp/attachments \
    && chown -R zerp:zerp /var/lib/zerp

COPY --from=build /out/zerp-server /usr/local/bin/zerp-server
COPY --from=build /out/zerp-cleanup-vou-attachments /usr/local/bin/zerp-cleanup-vou-attachments

USER zerp
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/zerp-server"]

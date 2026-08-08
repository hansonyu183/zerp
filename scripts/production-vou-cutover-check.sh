#!/bin/sh
set -eu

docker exec zerp-back-api-1 /usr/local/bin/zerp-vou-cutover-check

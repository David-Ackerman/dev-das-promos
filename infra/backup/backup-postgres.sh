#!/usr/bin/env bash
set -Eeuo pipefail

: "${BACKUP_S3_BUCKET:?Set BACKUP_S3_BUCKET in /etc/das-promos-backup.env}"
: "${BACKUP_AWS_REGION:?Set BACKUP_AWS_REGION in /etc/das-promos-backup.env}"

compose_file="infra/docker/docker-compose.prod.yml"
backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/das-promos-backup.XXXXXX")"
backup_time="$(date -u +%Y%m%dT%H%M%SZ)"
backup_name="das-promos-${backup_time}.dump"
backup_path="${backup_dir}/${backup_name}"
backup_key="postgres/${backup_name}"

cleanup() {
	rm -rf -- "${backup_dir}"
}
trap cleanup EXIT
chmod 700 "${backup_dir}"

docker compose -f "${compose_file}" exec -T postgres \
	pg_dump -U das_promos -d das_promos --format=custom --no-owner --no-acl \
	> "${backup_path}"
test -s "${backup_path}"
# Reject a truncated or unreadable archive before it is uploaded as a backup.
docker compose -f "${compose_file}" exec -T postgres pg_restore --list \
	< "${backup_path}" > /dev/null

(cd "${backup_dir}" && sha256sum "${backup_name}" > "${backup_name}.sha256")

aws --region "${BACKUP_AWS_REGION}" s3 cp \
	"${backup_path}" "s3://${BACKUP_S3_BUCKET}/${backup_key}" \
	--sse AES256 --only-show-errors
aws --region "${BACKUP_AWS_REGION}" s3 cp \
	"${backup_path}.sha256" "s3://${BACKUP_S3_BUCKET}/${backup_key}.sha256" \
	--sse AES256 --only-show-errors

echo "PostgreSQL backup uploaded: s3://${BACKUP_S3_BUCKET}/${backup_key}"

FROM postgres:17-alpine

RUN apk add --no-cache \
    bash \
    tzdata \
    age=1.3.2-r1 \
    rclone=1.75.2-r0

ENV TZ=Asia/Dhaka
ENV BACKUP_DIR=/backups

COPY scripts/backup.sh /usr/local/bin/backup.sh
COPY deploy/backup/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

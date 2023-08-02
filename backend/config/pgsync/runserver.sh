#! /bin/sh

./pgsync/wait-for-it.sh $PG_HOST:$PG_PORT -t 60

./pgsync/wait-for-it.sh $ELASTICSEARCH_HOST:$ELASTICSEARCH_PORT -t 60

./pgsync/wait-for-it.sh $REDIS_HOST:$REDIS_PORT -t 60

bootstrap --config ./pgsync/schema.json

pgsync --config ./pgsync/schema.json --daemon

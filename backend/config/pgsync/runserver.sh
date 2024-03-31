#! /bin/sh

/code/pgsync/wait-for-it.sh $PG_HOST:$PG_PORT -t 60

/code/pgsync/wait-for-it.sh $ELASTICSEARCH_HOST:$ELASTICSEARCH_PORT -t 60

/code/pgsync/wait-for-it.sh $REDIS_HOST:$REDIS_PORT -t 60

bootstrap --config /code/pgsync/schema.json

pgsync --config /code/pgsync/schema.json --daemon

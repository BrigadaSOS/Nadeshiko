# Nadeshiko API -- Endpoint Payloads Reference

> Reviewed against current endpoint implementations and generated routes.
> Source of schemas: `docs/generated/openapi.yaml`.

## Table of Contents

- [Search](#search)
  - [POST /v1/search](#post-v1-search)
  - [POST /v1/search/stats](#post-v1-search-stats)
  - [POST /v1/search/words](#post-v1-search-words)
- [Admin](#admin)
  - [GET /v1/admin/dashboard](#get-v1-admin-dashboard)
  - [GET /v1/admin/health](#get-v1-admin-health)
  - [GET /v1/admin/queues/{queueName}](#get-v1-admin-queues-queuename)
  - [GET /v1/admin/queues/{queueName}/failed](#get-v1-admin-queues-queuename-failed)
  - [DELETE /v1/admin/queues/{queueName}/purge](#delete-v1-admin-queues-queuename-purge)
  - [POST /v1/admin/queues/{queueName}/retry](#post-v1-admin-queues-queuename-retry)
  - [GET /v1/admin/queues/stats](#get-v1-admin-queues-stats)
  - [POST /v1/admin/reindex](#post-v1-admin-reindex)
  - [GET /v1/admin/reports](#get-v1-admin-reports)
  - [PATCH /v1/admin/reports/{id}](#patch-v1-admin-reports-id)
  - [GET /v1/admin/review/allowlist](#get-v1-admin-review-allowlist)
  - [POST /v1/admin/review/allowlist](#post-v1-admin-review-allowlist)
  - [DELETE /v1/admin/review/allowlist/{id}](#delete-v1-admin-review-allowlist-id)
  - [GET /v1/admin/review/checks](#get-v1-admin-review-checks)
  - [PATCH /v1/admin/review/checks/{name}](#patch-v1-admin-review-checks-name)
  - [POST /v1/admin/review/run](#post-v1-admin-review-run)
  - [GET /v1/admin/review/runs](#get-v1-admin-review-runs)
  - [GET /v1/admin/review/runs/{id}](#get-v1-admin-review-runs-id)
- [Media](#media)
  - [GET /v1/media](#get-v1-media)
  - [POST /v1/media](#post-v1-media)
  - [GET /v1/media/{id}](#get-v1-media-id)
  - [PATCH /v1/media/{id}](#patch-v1-media-id)
  - [DELETE /v1/media/{id}](#delete-v1-media-id)
  - [GET /v1/media/{mediaId}/episodes](#get-v1-media-mediaid-episodes)
  - [POST /v1/media/{mediaId}/episodes](#post-v1-media-mediaid-episodes)
  - [GET /v1/media/{mediaId}/episodes/{episodeNumber}](#get-v1-media-mediaid-episodes-episodenumber)
  - [PATCH /v1/media/{mediaId}/episodes/{episodeNumber}](#patch-v1-media-mediaid-episodes-episodenumber)
  - [DELETE /v1/media/{mediaId}/episodes/{episodeNumber}](#delete-v1-media-mediaid-episodes-episodenumber)
  - [GET /v1/media/{mediaId}/episodes/{episodeNumber}/segments](#get-v1-media-mediaid-episodes-episodenumber-segments)
  - [POST /v1/media/{mediaId}/episodes/{episodeNumber}/segments](#post-v1-media-mediaid-episodes-episodenumber-segments)
  - [GET /v1/media/{mediaId}/episodes/{episodeNumber}/segments/{id}](#get-v1-media-mediaid-episodes-episodenumber-segments-id)
  - [PATCH /v1/media/{mediaId}/episodes/{episodeNumber}/segments/{id}](#patch-v1-media-mediaid-episodes-episodenumber-segments-id)
  - [DELETE /v1/media/{mediaId}/episodes/{episodeNumber}/segments/{id}](#delete-v1-media-mediaid-episodes-episodenumber-segments-id)
  - [GET /v1/media/characters/{id}](#get-v1-media-characters-id)
  - [GET /v1/media/segments/{uuid}](#get-v1-media-segments-uuid)
  - [GET /v1/media/segments/{uuid}/context](#get-v1-media-segments-uuid-context)
  - [GET /v1/media/seiyuu/{id}](#get-v1-media-seiyuu-id)
  - [GET /v1/media/series](#get-v1-media-series)
  - [POST /v1/media/series](#post-v1-media-series)
  - [GET /v1/media/series/{id}](#get-v1-media-series-id)
  - [PATCH /v1/media/series/{id}](#patch-v1-media-series-id)
  - [DELETE /v1/media/series/{id}](#delete-v1-media-series-id)
  - [POST /v1/media/series/{id}/media](#post-v1-media-series-id-media)
  - [PATCH /v1/media/series/{id}/media/{mediaId}](#patch-v1-media-series-id-media-mediaid)
  - [DELETE /v1/media/series/{id}/media/{mediaId}](#delete-v1-media-series-id-media-mediaid)
- [User](#user)
  - [GET /v1/user/activity](#get-v1-user-activity)
  - [DELETE /v1/user/activity](#delete-v1-user-activity)
  - [GET /v1/user/activity/stats](#get-v1-user-activity-stats)
  - [GET /v1/user/export](#get-v1-user-export)
  - [GET /v1/user/labs](#get-v1-user-labs)
  - [GET /v1/user/preferences](#get-v1-user-preferences)
  - [PATCH /v1/user/preferences](#patch-v1-user-preferences)
  - [GET /v1/user/quota](#get-v1-user-quota)
  - [GET /v1/user/reports](#get-v1-user-reports)
  - [POST /v1/user/reports](#post-v1-user-reports)
- [Collections](#collections)
  - [GET /v1/collections](#get-v1-collections)
  - [POST /v1/collections](#post-v1-collections)
  - [GET /v1/collections/{id}](#get-v1-collections-id)
  - [PATCH /v1/collections/{id}](#patch-v1-collections-id)
  - [DELETE /v1/collections/{id}](#delete-v1-collections-id)
  - [POST /v1/collections/{id}/segments](#post-v1-collections-id-segments)
  - [PATCH /v1/collections/{id}/segments/{uuid}](#patch-v1-collections-id-segments-uuid)
  - [DELETE /v1/collections/{id}/segments/{uuid}](#delete-v1-collections-id-segments-uuid)

---

## Search

### POST /v1/search

Search segments by query

**Auth:** API key (Bearer token) or Session cookie

**Request JSON:**

```json
{
  "query": {
    "search": "(猫 OR 犬) AND 好き",
    "exactMatch": false
  },
  "limit": 10,
  "cursor": [
    23.31727,
    7
  ],
  "sort": {
    "mode": "NONE",
    "seed": 42
  },
  "filters": {
    "media": {
      "include": [
        {
          "mediaId": 123,
          "episodes": [
            1,
            2
          ]
        }
      ],
      "exclude": [
        {
          "mediaId": 123,
          "episodes": [
            1,
            2
          ]
        }
      ]
    },
    "category": [
      "ANIME",
      "JDRAMA"
    ],
    "contentRating": [
      "SAFE"
    ],
    "status": [
      "ACTIVE"
    ],
    "segmentLengthChars": {
      "min": 10,
      "max": 50
    },
    "segmentDurationMs": {
      "min": 1000,
      "max": 10000
    }
  },
  "include": [
    "media"
  ]
}
```

**Response JSON (`200`):**

```json
{
  "segments": [
    {
      "uuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
      "position": 1133,
      "status": "ACTIVE",
      "startTimeMs": 2007255,
      "endTimeMs": 2008464,
      "contentRating": "SAFE",
      "episode": 1,
      "mediaId": 7674,
      "textJa": {
        "content": "僕は僕で、君は君だ。",
        "highlight": "string"
      },
      "textEn": {
        "content": "I am me, and you are you.",
        "isMachineTranslated": false,
        "highlight": "string"
      },
      "textEs": {
        "content": "Yo soy yo, y tú eres tú.",
        "isMachineTranslated": false,
        "highlight": "string"
      },
      "urls": {
        "imageUrl": "https://example.com/resource",
        "audioUrl": "https://example.com/resource",
        "videoUrl": "https://example.com/resource"
      }
    }
  ],
  "includes": {
    "media": {
      "example": {
        "id": 7674,
        "externalIds": {
          "anilist": "21459",
          "imdb": "tt1234567",
          "tvdb": "12345"
        },
        "nameJa": "バクマン。",
        "nameRomaji": "Bakuman.",
        "nameEn": "Bakuman.",
        "airingFormat": "TV",
        "airingStatus": "FINISHED",
        "genres": [
          "Comedy",
          "Drama",
          "Romance",
          "Slice of Life"
        ],
        "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
        "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
        "startDate": "2010-10-02",
        "endDate": "2011-04-02",
        "category": "ANIME",
        "segmentCount": 0,
        "episodeCount": 25,
        "studio": "J.C.STAFF",
        "seasonName": "FALL",
        "seasonYear": 2010,
        "characters": [
          {
                          "id": 14545,
              "nameJa": "真城最高",
              "nameEn": "Moritaka Mashiro",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
            "seiyuu": {
              "id": 95991,
              "nameJa": "阿部敦",
              "nameEn": "Atsushi Abe",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
            },
            "role": "MAIN"
          }
        ]
      }
    }
  },
  "pagination": {
    "hasMore": true,
    "estimatedTotalHits": 12456,
    "estimatedTotalHitsRelation": "LOWER_BOUND",
    "cursor": [
      1
    ]
  }
}
```


### POST /v1/search/stats

Get search statistics

**Auth:** API key (Bearer token) or Session cookie

**Request JSON:**

```json
{
  "query": {
    "search": "彼女",
    "exactMatch": false
  },
  "filters": {
    "media": {
      "include": [
        {
          "mediaId": 123,
          "episodes": [
            1,
            2
          ]
        }
      ],
      "exclude": [
        {
          "mediaId": 123,
          "episodes": [
            1,
            2
          ]
        }
      ]
    },
    "category": [
      "ANIME",
      "JDRAMA"
    ],
    "contentRating": [
      "SAFE"
    ],
    "status": [
      "ACTIVE"
    ],
    "segmentLengthChars": {
      "min": 10,
      "max": 50
    },
    "segmentDurationMs": {
      "min": 1000,
      "max": 10000
    }
  },
  "include": []
}
```

**Response JSON (`200`):**

```json
{
  "media": [
    {
      "mediaId": 110316,
      "matchCount": 42,
      "episodeHits": {
        "1": 5,
        "2": 8,
        "3": 3
      }
    }
  ],
  "categories": [
    {
      "category": "ANIME",
      "count": 1523
    }
  ],
  "includes": {
    "media": {
      "example": {
        "id": 7674,
        "externalIds": {
          "anilist": "21459",
          "imdb": "tt1234567",
          "tvdb": "12345"
        },
        "nameJa": "バクマン。",
        "nameRomaji": "Bakuman.",
        "nameEn": "Bakuman.",
        "airingFormat": "TV",
        "airingStatus": "FINISHED",
        "genres": [
          "Comedy",
          "Drama",
          "Romance",
          "Slice of Life"
        ],
        "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
        "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
        "startDate": "2010-10-02",
        "endDate": "2011-04-02",
        "category": "ANIME",
        "segmentCount": 0,
        "episodeCount": 25,
        "studio": "J.C.STAFF",
        "seasonName": "FALL",
        "seasonYear": 2010,
        "characters": [
          {
                          "id": 14545,
              "nameJa": "真城最高",
              "nameEn": "Moritaka Mashiro",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
            "seiyuu": {
              "id": 95991,
              "nameJa": "阿部敦",
              "nameEn": "Atsushi Abe",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
            },
            "role": "MAIN"
          }
        ]
      }
    }
  }
}
```


### POST /v1/search/words

Search by multiple words

**Auth:** API key (Bearer token) or Session cookie

**Request JSON:**

```json
{
  "query": {
    "words": [
      "彼女",
      "私"
    ],
    "exactMatch": false
  },
  "filters": {
    "media": {
      "include": [
        {
          "mediaId": 123,
          "episodes": [
            1,
            2
          ]
        }
      ],
      "exclude": [
        {
          "mediaId": 123,
          "episodes": [
            1,
            2
          ]
        }
      ]
    },
    "category": [
      "ANIME",
      "JDRAMA"
    ],
    "contentRating": [
      "SAFE"
    ],
    "status": [
      "ACTIVE"
    ],
    "segmentLengthChars": {
      "min": 10,
      "max": 50
    },
    "segmentDurationMs": {
      "min": 1000,
      "max": 10000
    }
  },
  "include": []
}
```

**Response JSON (`200`):**

```json
{
  "results": [
    {
      "word": "彼女",
      "isMatch": true,
      "matchCount": 1523,
      "media": [
        {
          "mediaId": 110316,
          "matchCount": 234
        }
      ]
    }
  ],
  "includes": {
    "media": {
      "example": {
        "id": 7674,
        "externalIds": {
          "anilist": "21459",
          "imdb": "tt1234567",
          "tvdb": "12345"
        },
        "nameJa": "バクマン。",
        "nameRomaji": "Bakuman.",
        "nameEn": "Bakuman.",
        "airingFormat": "TV",
        "airingStatus": "FINISHED",
        "genres": [
          "Comedy",
          "Drama",
          "Romance",
          "Slice of Life"
        ],
        "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
        "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
        "startDate": "2010-10-02",
        "endDate": "2011-04-02",
        "category": "ANIME",
        "segmentCount": 0,
        "episodeCount": 25,
        "studio": "J.C.STAFF",
        "seasonName": "FALL",
        "seasonYear": 2010,
        "characters": [
          {
                          "id": 14545,
              "nameJa": "真城最高",
              "nameEn": "Moritaka Mashiro",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
            "seiyuu": {
              "id": 95991,
              "nameJa": "阿部敦",
              "nameEn": "Atsushi Abe",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
            },
            "role": "MAIN"
          }
        ]
      }
    }
  }
}
```


---

## Admin

### GET /v1/admin/dashboard

Admin dashboard statistics

**Auth:** API key (Bearer token)

**Response JSON (`200`):**

```json
{
  "media": {
    "totalMedia": 1,
    "totalEpisodes": 1,
    "totalSegments": 1,
    "totalCharacters": 1,
    "totalSeiyuu": 1
  },
  "users": {
    "totalUsers": 1,
    "recentlyRegisteredCount": 1,
    "recentlyActiveCount": 1
  },
  "system": {
    "status": "healthy",
    "app": {
      "version": "string"
    },
    "elasticsearch": {
      "status": "connected",
      "version": "string",
      "clusterName": "string",
      "clusterStatus": "string",
      "indexName": "string",
      "documentCount": 1
    },
    "database": {
      "status": "connected",
      "version": "string"
    },
    "queues": [
      {
        "queue": "string",
        "stuckCount": 1,
        "failedCount": 1
      }
    ]
  }
}
```


### GET /v1/admin/health

System health check

**Auth:** API key (Bearer token)

**Response JSON (`200`):**

```json
{
  "status": "healthy",
  "app": {
    "version": "string"
  },
  "elasticsearch": {
    "status": "connected",
    "version": "string",
    "clusterName": "string",
    "clusterStatus": "string",
    "indexName": "string",
    "documentCount": 1
  },
  "database": {
    "status": "connected",
    "version": "string"
  }
}
```


### GET /v1/admin/queues/{queueName}

Get detailed queue information

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `queueName` | string | yes | `es-sync-create` |

**Response JSON (`200`):**

```json
{
  "queue": "es-sync-create",
  "stats": {
    "deferred": 1,
    "queued": 10,
    "active": 2,
    "total": 13
  },
  "metadata": {
    "policy": "standard",
    "partition": false,
    "deadLetter": null,
    "warningQueueSize": null,
    "retryLimit": 5,
    "retryDelay": 1,
    "retryBackoff": true,
    "retryDelayMax": null,
    "expireInSeconds": 3600,
    "retentionSeconds": 86400,
    "deleteAfterSeconds": null,
    "createdOn": "2026-02-19T10:30:00.000Z",
    "updatedOn": "2026-02-19T10:30:00.000Z",
    "singletonsActive": [],
    "table": "job"
  }
}
```


### GET /v1/admin/queues/{queueName}/failed

Get failed jobs from a queue

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `queueName` | string | yes | `es-sync-create` |

**Response JSON (`200`):**

```json
[
  {
    "id": "example-id",
    "segmentId": 1,
    "error": "string",
    "createdOn": "2026-02-19T10:30:00.000Z"
  }
]
```


### DELETE /v1/admin/queues/{queueName}/purge

Purge failed jobs from a queue

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `queueName` | string | yes | `es-sync-create` |

**Response JSON (`200`):**

```json
{
  "success": true,
  "purgedCount": 15,
  "message": "Purged 15 failed jobs from es-sync-create"
}
```


### POST /v1/admin/queues/{queueName}/retry

Retry failed jobs from a queue

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `queueName` | string | yes | `es-sync-create` |

**Response JSON (`200`):**

```json
{
  "success": true,
  "retriedCount": 5,
  "message": "Retried 5 failed jobs from es-sync-create"
}
```


### GET /v1/admin/queues/stats

Get queue statistics

**Auth:** API key (Bearer token)

**Response JSON (`200`):**

```json
[
  {
    "queue": "es-sync-create",
    "stuckCount": 5,
    "failedCount": 2
  }
]
```


### POST /v1/admin/reindex

Reindex database into Elasticsearch

**Auth:** API key (Bearer token)

**Request JSON:**

```json
{
  "media": [
    {
      "mediaId": 5,
      "episodes": [
        1,
        3
      ]
    },
    {
      "mediaId": 10
    }
  ]
}
```

**Response JSON (`200`):**

```json
{
  "success": true,
  "message": "string",
  "stats": {
    "totalSegments": 1,
    "successfulIndexes": 1,
    "failedIndexes": 1,
    "mediaProcessed": 1
  },
  "errors": [
    {
      "segmentId": 1,
      "error": "string"
    }
  ]
}
```


### GET /v1/admin/reports

List all reports

**Auth:** API key (Bearer token)

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `cursor` | integer | no | `1` |
| `limit` | integer | no | `20` |
| `status` | string | no | `PENDING` |
| `source` | string | no | `USER` |
| `target.type` | string | no | `SEGMENT` |
| `target.mediaId` | integer | no | `1` |
| `target.episodeNumber` | integer | no | `5` |
| `target.segmentUuid` | string | no | `3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e` |
| `reviewCheckRunId` | integer | no | `1` |

**Response JSON (`200`):**

```json
{
  "reports": [
    {
      "id": 1,
      "source": "USER",
      "target": {
        "type": "SEGMENT",
        "mediaId": 42,
        "episodeNumber": 5,
        "segmentUuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e"
      },
      "reviewCheckRunId": 1,
      "reason": "WRONG_TRANSLATION",
      "description": "string",
      "data": {
        "example": "value"
      },
      "status": "PENDING",
      "adminNotes": "string",
      "userId": 42,
      "createdAt": "2026-02-19T10:30:00.000Z",
      "updatedAt": "2026-02-19T10:30:00.000Z",
      "reportCount": 3,
      "reporterName": "john_doe"
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": 10
  }
}
```


### PATCH /v1/admin/reports/{id}

Update a report

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |

**Request JSON:**

```json
{
  "status": "ACCEPTED",
  "adminNotes": "Confirmed wrong translation, will fix"
}
```

**Response JSON (`200`):**

```json
{
  "id": 1,
  "source": "USER",
  "target": {
    "type": "SEGMENT",
    "mediaId": 42,
    "episodeNumber": 5,
    "segmentUuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e"
  },
  "reviewCheckRunId": 1,
  "reason": "WRONG_TRANSLATION",
  "description": "string",
  "data": {
    "example": "value"
  },
  "status": "PENDING",
  "adminNotes": "string",
  "userId": 42,
  "createdAt": "2026-02-19T10:30:00.000Z",
  "updatedAt": "2026-02-19T10:30:00.000Z"
}
```


### GET /v1/admin/review/allowlist

List allowlisted items

**Auth:** API key (Bearer token)

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `checkName` | string | no | `string` |

**Response JSON (`200`):**

```json
[
  {
    "id": 1,
    "checkName": "lowSegmentMedia",
    "mediaId": 42,
    "episodeNumber": 1,
    "reason": "Known short OVA series",
    "createdAt": "2026-02-19T10:30:00.000Z"
  }
]
```


### POST /v1/admin/review/allowlist

Add to allowlist

**Auth:** API key (Bearer token)

**Request JSON:**

```json
{
  "checkName": "string",
  "mediaId": 1,
  "episodeNumber": 1,
  "reason": "string"
}
```

**Response JSON (`201`):**

```json
{
  "id": 1,
  "checkName": "lowSegmentMedia",
  "mediaId": 42,
  "episodeNumber": 1,
  "reason": "Known short OVA series",
  "createdAt": "2026-02-19T10:30:00.000Z"
}
```


### DELETE /v1/admin/review/allowlist/{id}

Remove from allowlist

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |

**Response:** `204` (no JSON body)


### GET /v1/admin/review/checks

List all review checks

**Auth:** API key (Bearer token)

**Response JSON (`200`):**

```json
[
  {
    "id": 1,
    "name": "lowSegmentMedia",
    "label": "Low Segment Media",
    "description": "string",
    "targetType": "MEDIA",
    "threshold": {
      "example": "value"
    },
    "enabled": true,
    "thresholdSchema": [
      {
        "key": "string",
        "label": "string",
        "type": "number",
        "default": 1,
        "min": 1,
        "max": 1
      }
    ],
    "latestRun": {
      "id": 1,
      "resultCount": 1,
      "createdAt": "2026-02-19T10:30:00.000Z"
    },
    "createdAt": "2026-02-19T10:30:00.000Z",
    "updatedAt": "2026-02-19T10:30:00.000Z"
  }
]
```


### PATCH /v1/admin/review/checks/{name}

Update a review check config

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `name` | string | yes | `string` |

**Request JSON:**

```json
{
  "threshold": {
    "example": "value"
  },
  "enabled": true
}
```

**Response JSON (`200`):**

```json
{
  "id": 1,
  "name": "lowSegmentMedia",
  "label": "Low Segment Media",
  "description": "string",
  "targetType": "MEDIA",
  "threshold": {
    "example": "value"
  },
  "enabled": true,
  "thresholdSchema": [
    {
      "key": "string",
      "label": "string",
      "type": "number",
      "default": 1,
      "min": 1,
      "max": 1
    }
  ],
  "latestRun": {
    "id": 1,
    "resultCount": 1,
    "createdAt": "2026-02-19T10:30:00.000Z"
  },
  "createdAt": "2026-02-19T10:30:00.000Z",
  "updatedAt": "2026-02-19T10:30:00.000Z"
}
```


### POST /v1/admin/review/run

Run auto-checks

**Auth:** API key (Bearer token)

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `category` | string | no | `ANIME` |

**Response JSON (`200`):**

```json
{
  "category": "string",
  "checksRun": [
    {
      "checkName": "string",
      "label": "string",
      "resultCount": 1,
      "runId": 1
    }
  ],
  "totalReports": 1
}
```


### GET /v1/admin/review/runs

List past check runs

**Auth:** API key (Bearer token)

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `checkName` | string | no | `string` |
| `cursor` | integer | no | `1` |
| `limit` | integer | no | `20` |

**Response JSON (`200`):**

```json
{
  "runs": [
    {
      "id": 1,
      "checkName": "lowSegmentMedia",
      "category": "string",
      "resultCount": 12,
      "thresholdUsed": {
        "example": "value"
      },
      "createdAt": "2026-02-19T10:30:00.000Z"
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": 1
  }
}
```


### GET /v1/admin/review/runs/{id}

Get a specific run's details

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |

**Query parameters:**

| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `include` | string[] | no | `["media"]` | supports `media` and `media.characters` |

Use `include=["media.characters"]` to include character/seiyuu data for each media entry.

**Response JSON (`200`):**

```json
{
  "run": {
    "id": 1,
    "checkName": "lowSegmentMedia",
    "category": "string",
    "resultCount": 12,
    "thresholdUsed": {
      "example": "value"
    },
    "createdAt": "2026-02-19T10:30:00.000Z"
  },
  "reports": [
    {
      "id": 1,
      "source": "USER",
      "target": {
        "type": "SEGMENT",
        "mediaId": 42,
        "episodeNumber": 5,
        "segmentUuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e"
      },
      "reviewCheckRunId": 1,
      "reason": "WRONG_TRANSLATION",
      "description": "string",
      "data": {
        "example": "value"
      },
      "status": "PENDING",
      "adminNotes": "string",
      "userId": 42,
      "createdAt": "2026-02-19T10:30:00.000Z",
      "updatedAt": "2026-02-19T10:30:00.000Z"
    }
  ]
}
```


---

## Media

### GET /v1/media

List all media

**Auth:** API key (Bearer token)

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `limit` | integer | no | `20` |
| `cursor` | integer | no | `0` |
| `category` | string | no | `ANIME` |
| `query` | string | no | `steins` |
| `include` | array[string] | no | `["media"]` |

Use `include=["media.characters"]` to include character/seiyuu data (`media` is implied).

**Response JSON (`200`):**

```json
{
  "media": [
    {
      "id": 7674,
      "externalIds": {
        "anilist": "21459",
        "imdb": "tt1234567",
        "tvdb": "12345"
      },
      "nameJa": "バクマン。",
      "nameRomaji": "Bakuman.",
      "nameEn": "Bakuman.",
      "airingFormat": "TV",
      "airingStatus": "FINISHED",
      "genres": [
        "Comedy",
        "Drama",
        "Romance",
        "Slice of Life"
      ],
      "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
      "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
      "startDate": "2010-10-02",
      "endDate": "2011-04-02",
      "category": "ANIME",
      "segmentCount": 0,
      "episodeCount": 25,
      "studio": "J.C.STAFF",
      "seasonName": "FALL",
      "seasonYear": 2010,
      "characters": [
        {
                      "id": 14545,
            "nameJa": "真城最高",
            "nameEn": "Moritaka Mashiro",
            "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
          "seiyuu": {
            "id": 95991,
            "nameJa": "阿部敦",
            "nameEn": "Atsushi Abe",
            "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
          },
          "role": "MAIN"
        }
      ]
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": 1
  }
}
```


### POST /v1/media

Create new media

**Auth:** API key (Bearer token)

**Request JSON:**

```json
{
  "externalIds": {
    "anilist": "21459",
    "imdb": "tt1234567",
    "tvdb": "12345"
  },
  "nameJa": "バクマン。",
  "nameRomaji": "Bakuman.",
  "nameEn": "Bakuman.",
  "airingFormat": "TV",
  "airingStatus": "FINISHED",
  "genres": [
    "Comedy",
    "Drama",
    "Romance",
    "Slice of Life"
  ],
  "storage": "R2",
  "startDate": "2010-10-02",
  "endDate": "2011-04-02",
  "category": "ANIME",
  "version": "6",
  "hashSalt": "ba0cbe173ed310528f16130273662a60",
  "studio": "J.C.STAFF",
  "seasonName": "FALL",
  "seasonYear": 2010,
  "storageBasePath": "media/21459",
  "characters": []
}
```

**Response JSON (`201`):**

```json
{
  "id": 7674,
  "externalIds": {
    "anilist": "21459",
    "imdb": "tt1234567",
    "tvdb": "12345"
  },
  "nameJa": "バクマン。",
  "nameRomaji": "Bakuman.",
  "nameEn": "Bakuman.",
  "airingFormat": "TV",
  "airingStatus": "FINISHED",
  "genres": [
    "Comedy",
    "Drama",
    "Romance",
    "Slice of Life"
  ],
  "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
  "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
  "startDate": "2010-10-02",
  "endDate": "2011-04-02",
  "category": "ANIME",
  "segmentCount": 0,
  "episodeCount": 25,
  "studio": "J.C.STAFF",
  "seasonName": "FALL",
  "seasonYear": 2010,
  "characters": [
    {
              "id": 14545,
        "nameJa": "真城最高",
        "nameEn": "Moritaka Mashiro",
        "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
      "seiyuu": {
        "id": 95991,
        "nameJa": "阿部敦",
        "nameEn": "Atsushi Abe",
        "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
      },
      "role": "MAIN"
    }
  ]
}
```


### GET /v1/media/{id}

Get single media

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `7674` |

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `include` | array[string] | no | `["media"]` |

Use `include=["media.characters"]` to include character/seiyuu data (`media` is implied).

**Response JSON (`200`):**

```json
{
  "id": 7674,
  "externalIds": {
    "anilist": "21459",
    "imdb": "tt1234567",
    "tvdb": "12345"
  },
  "nameJa": "バクマン。",
  "nameRomaji": "Bakuman.",
  "nameEn": "Bakuman.",
  "airingFormat": "TV",
  "airingStatus": "FINISHED",
  "genres": [
    "Comedy",
    "Drama",
    "Romance",
    "Slice of Life"
  ],
  "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
  "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
  "startDate": "2010-10-02",
  "endDate": "2011-04-02",
  "category": "ANIME",
  "segmentCount": 0,
  "episodeCount": 25,
  "studio": "J.C.STAFF",
  "seasonName": "FALL",
  "seasonYear": 2010,
  "characters": [
    {
              "id": 14545,
        "nameJa": "真城最高",
        "nameEn": "Moritaka Mashiro",
        "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
      "seiyuu": {
        "id": 95991,
        "nameJa": "阿部敦",
        "nameEn": "Atsushi Abe",
        "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
      },
      "role": "MAIN"
    }
  ]
}
```


### PATCH /v1/media/{id}

Update media

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `7674` |

**Request JSON:**

```json
{
  "externalIds": {
    "anilist": "21459",
    "imdb": "tt1234567",
    "tvdb": "12345"
  },
  "nameJa": "バクマン。",
  "nameRomaji": "Bakuman.",
  "nameEn": "Bakuman.",
  "airingFormat": "TV",
  "airingStatus": "FINISHED",
  "genres": [
    "Comedy",
    "Drama",
    "Romance",
    "Slice of Life"
  ],
  "storage": "R2",
  "startDate": "2010-10-02",
  "endDate": "2011-04-02",
  "category": "ANIME",
  "version": "6",
  "hashSalt": "ba0cbe173ed310528f16130273662a60",
  "studio": "J.C.STAFF",
  "seasonName": "FALL",
  "seasonYear": 2010,
  "storageBasePath": "media/21459",
  "characters": [],
  "segmentCount": 1234
}
```

**Response JSON (`200`):**

```json
{
  "id": 7674,
  "externalIds": {
    "anilist": "21459",
    "imdb": "tt1234567",
    "tvdb": "12345"
  },
  "nameJa": "バクマン。",
  "nameRomaji": "Bakuman.",
  "nameEn": "Bakuman.",
  "airingFormat": "TV",
  "airingStatus": "FINISHED",
  "genres": [
    "Comedy",
    "Drama",
    "Romance",
    "Slice of Life"
  ],
  "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
  "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
  "startDate": "2010-10-02",
  "endDate": "2011-04-02",
  "category": "ANIME",
  "segmentCount": 0,
  "episodeCount": 25,
  "studio": "J.C.STAFF",
  "seasonName": "FALL",
  "seasonYear": 2010,
  "characters": [
    {
              "id": 14545,
        "nameJa": "真城最高",
        "nameEn": "Moritaka Mashiro",
        "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
      "seiyuu": {
        "id": 95991,
        "nameJa": "阿部敦",
        "nameEn": "Atsushi Abe",
        "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
      },
      "role": "MAIN"
    }
  ]
}
```


### DELETE /v1/media/{id}

Delete media (soft delete)

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `7674` |

**Response:** `204` (no JSON body)


### GET /v1/media/{mediaId}/episodes

List episodes for a media

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `limit` | integer | no | `50` |
| `cursor` | integer | no | `0` |

**Response JSON (`200`):**

```json
{
  "episodes": [
    {
      "mediaId": 7674,
      "episodeNumber": 1,
      "titleEn": "The Beginning",
      "titleRomaji": "Hajimari",
      "titleJa": "始まり",
      "description": "The hero begins their journey",
      "airedAt": "2024-01-15T09:00:00Z",
      "lengthSeconds": 1420,
      "thumbnailUrl": "https://example.com/thumbnails/episode1.jpg",
      "segmentCount": 450
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": 12
  }
}
```


### POST /v1/media/{mediaId}/episodes

Create new episode

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |

**Request JSON:**

```json
{
  "titleEn": "The Beginning",
  "titleRomaji": "Hajimari",
  "titleJa": "始まり",
  "description": "The hero begins their journey",
  "airedAt": "2024-01-15T09:00:00Z",
  "lengthSeconds": 1420,
  "thumbnailUrl": "https://example.com/thumbnails/episode1.jpg",
  "episodeNumber": 1
}
```

**Response JSON (`201`):**

```json
{
  "mediaId": 7674,
  "episodeNumber": 1,
  "titleEn": "The Beginning",
  "titleRomaji": "Hajimari",
  "titleJa": "始まり",
  "description": "The hero begins their journey",
  "airedAt": "2024-01-15T09:00:00Z",
  "lengthSeconds": 1420,
  "thumbnailUrl": "https://example.com/thumbnails/episode1.jpg",
  "segmentCount": 450
}
```


### GET /v1/media/{mediaId}/episodes/{episodeNumber}

Get single episode

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |
| `episodeNumber` | integer | yes | `1` |

**Response JSON (`200`):**

```json
{
  "mediaId": 7674,
  "episodeNumber": 1,
  "titleEn": "The Beginning",
  "titleRomaji": "Hajimari",
  "titleJa": "始まり",
  "description": "The hero begins their journey",
  "airedAt": "2024-01-15T09:00:00Z",
  "lengthSeconds": 1420,
  "thumbnailUrl": "https://example.com/thumbnails/episode1.jpg",
  "segmentCount": 450
}
```


### PATCH /v1/media/{mediaId}/episodes/{episodeNumber}

Update episode

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |
| `episodeNumber` | integer | yes | `1` |

**Request JSON:**

```json
{
  "titleEn": "The Beginning",
  "titleRomaji": "Hajimari",
  "titleJa": "始まり",
  "description": "The hero begins their journey",
  "airedAt": "2024-01-15T09:00:00Z",
  "lengthSeconds": 1420,
  "thumbnailUrl": "https://example.com/thumbnails/episode1.jpg"
}
```

**Response JSON (`200`):**

```json
{
  "mediaId": 7674,
  "episodeNumber": 1,
  "titleEn": "The Beginning",
  "titleRomaji": "Hajimari",
  "titleJa": "始まり",
  "description": "The hero begins their journey",
  "airedAt": "2024-01-15T09:00:00Z",
  "lengthSeconds": 1420,
  "thumbnailUrl": "https://example.com/thumbnails/episode1.jpg",
  "segmentCount": 450
}
```


### DELETE /v1/media/{mediaId}/episodes/{episodeNumber}

Delete an episode

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |
| `episodeNumber` | integer | yes | `1` |

**Response:** `204` (no JSON body)


### GET /v1/media/{mediaId}/episodes/{episodeNumber}/segments

List segments for an episode

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |
| `episodeNumber` | integer | yes | `1` |

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `limit` | integer | no | `50` |
| `cursor` | integer | no | `0` |

**Response JSON (`200`):**

```json
{
  "segments": [
    {
      "uuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
      "position": 1133,
      "status": "ACTIVE",
      "startTimeMs": 2007255,
      "endTimeMs": 2008464,
      "contentRating": "SAFE",
      "episode": 1,
      "mediaId": 7674,
      "textJa": {
        "content": "僕は僕で、君は君だ。",
        "highlight": "string"
      },
      "textEn": {
        "content": "I am me, and you are you.",
        "isMachineTranslated": false,
        "highlight": "string"
      },
      "textEs": {
        "content": "Yo soy yo, y tú eres tú.",
        "isMachineTranslated": false,
        "highlight": "string"
      },
      "urls": {
        "imageUrl": "https://example.com/resource",
        "audioUrl": "https://example.com/resource",
        "videoUrl": "https://example.com/resource"
      },
      "storage": "R2",
      "hashedId": "0d39e46b14",
      "storageBasePath": "anime/steins-gate",
      "ratingAnalysis": {},
      "posAnalysis": {}
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": 12345
  }
}
```


### POST /v1/media/{mediaId}/episodes/{episodeNumber}/segments

Create new segment

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |
| `episodeNumber` | integer | yes | `1` |

**Request JSON:**

```json
{
  "position": 1133,
  "status": "ACTIVE",
  "startTimeMs": 2007255,
  "endTimeMs": 2008464,
  "textJa": {
    "content": "僕は僕で、君は君だ。"
  },
  "textEs": {
    "content": "Yo soy yo, y tú eres tú.",
    "isMachineTranslated": false
  },
  "textEn": {
    "content": "I am me, and you are you.",
    "isMachineTranslated": false
  },
  "contentRating": "SAFE",
  "ratingAnalysis": {},
  "posAnalysis": {},
  "storage": "R2",
  "hashedId": "0d39e46b14"
}
```

**Response JSON (`201`):**

```json
{
  "uuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
  "position": 1133,
  "status": "ACTIVE",
  "startTimeMs": 2007255,
  "endTimeMs": 2008464,
  "contentRating": "SAFE",
  "episode": 1,
  "mediaId": 7674,
  "textJa": {
    "content": "僕は僕で、君は君だ。",
    "highlight": "string"
  },
  "textEn": {
    "content": "I am me, and you are you.",
    "isMachineTranslated": false,
    "highlight": "string"
  },
  "textEs": {
    "content": "Yo soy yo, y tú eres tú.",
    "isMachineTranslated": false,
    "highlight": "string"
  },
  "urls": {
    "imageUrl": "https://example.com/resource",
    "audioUrl": "https://example.com/resource",
    "videoUrl": "https://example.com/resource"
  },
  "storage": "R2",
  "hashedId": "0d39e46b14",
  "storageBasePath": "anime/steins-gate",
  "ratingAnalysis": {},
  "posAnalysis": {}
}
```


### GET /v1/media/{mediaId}/episodes/{episodeNumber}/segments/{id}

Get single segment

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |
| `episodeNumber` | integer | yes | `1` |
| `id` | integer | yes | `1` |

**Response JSON (`200`):**

```json
{
  "uuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
  "position": 1133,
  "status": "ACTIVE",
  "startTimeMs": 2007255,
  "endTimeMs": 2008464,
  "contentRating": "SAFE",
  "episode": 1,
  "mediaId": 7674,
  "textJa": {
    "content": "僕は僕で、君は君だ。",
    "highlight": "string"
  },
  "textEn": {
    "content": "I am me, and you are you.",
    "isMachineTranslated": false,
    "highlight": "string"
  },
  "textEs": {
    "content": "Yo soy yo, y tú eres tú.",
    "isMachineTranslated": false,
    "highlight": "string"
  },
  "urls": {
    "imageUrl": "https://example.com/resource",
    "audioUrl": "https://example.com/resource",
    "videoUrl": "https://example.com/resource"
  }
}
```


### PATCH /v1/media/{mediaId}/episodes/{episodeNumber}/segments/{id}

Update segment

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |
| `episodeNumber` | integer | yes | `1` |
| `id` | integer | yes | `1` |

**Request JSON:**

```json
{
  "position": 1133,
  "status": "ACTIVE",
  "startTimeMs": 2007255,
  "endTimeMs": 2008464,
  "textJa": {
    "content": "僕は僕で、君は君だ。"
  },
  "textEs": {
    "content": "Yo soy yo, y tú eres tú.",
    "isMachineTranslated": false
  },
  "textEn": {
    "content": "I am me, and you are you.",
    "isMachineTranslated": false
  },
  "contentRating": "SAFE",
  "ratingAnalysis": {},
  "posAnalysis": {},
  "storage": "R2",
  "hashedId": "0d39e46b14"
}
```

**Response JSON (`200`):**

```json
{
  "uuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
  "position": 1133,
  "status": "ACTIVE",
  "startTimeMs": 2007255,
  "endTimeMs": 2008464,
  "contentRating": "SAFE",
  "episode": 1,
  "mediaId": 7674,
  "textJa": {
    "content": "僕は僕で、君は君だ。",
    "highlight": "string"
  },
  "textEn": {
    "content": "I am me, and you are you.",
    "isMachineTranslated": false,
    "highlight": "string"
  },
  "textEs": {
    "content": "Yo soy yo, y tú eres tú.",
    "isMachineTranslated": false,
    "highlight": "string"
  },
  "urls": {
    "imageUrl": "https://example.com/resource",
    "audioUrl": "https://example.com/resource",
    "videoUrl": "https://example.com/resource"
  },
  "storage": "R2",
  "hashedId": "0d39e46b14",
  "storageBasePath": "anime/steins-gate",
  "ratingAnalysis": {},
  "posAnalysis": {}
}
```


### DELETE /v1/media/{mediaId}/episodes/{episodeNumber}/segments/{id}

Delete segment

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `mediaId` | integer | yes | `1` |
| `episodeNumber` | integer | yes | `1` |
| `id` | integer | yes | `1` |

**Response:** `204` (no JSON body)


### GET /v1/media/characters/{id}

Get character details

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `14545` |

**Response JSON (`200`):**

```json
{
  "id": 14545,
  "nameJa": "真城最高",
  "nameEn": "Moritaka Mashiro",
  "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
  "seiyuu": {
    "id": 95991,
    "nameJa": "阿部敦",
    "nameEn": "Atsushi Abe",
    "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
  },
  "mediaAppearances": [
    {
      "media": {
        "id": 7674,
        "externalIds": {
          "anilist": "21459",
          "imdb": "tt1234567",
          "tvdb": "12345"
        },
        "nameJa": "バクマン。",
        "nameRomaji": "Bakuman.",
        "nameEn": "Bakuman.",
        "airingFormat": "TV",
        "airingStatus": "FINISHED",
        "genres": [
          "Comedy",
          "Drama",
          "Romance",
          "Slice of Life"
        ],
        "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
        "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
        "startDate": "2010-10-02",
        "endDate": "2011-04-02",
        "category": "ANIME",
        "segmentCount": 0,
        "episodeCount": 25,
        "studio": "J.C.STAFF",
        "seasonName": "FALL",
        "seasonYear": 2010,
        "characters": [
          {
                          "id": 14545,
              "nameJa": "真城最高",
              "nameEn": "Moritaka Mashiro",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
            "seiyuu": {
              "id": 95991,
              "nameJa": "阿部敦",
              "nameEn": "Atsushi Abe",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
            },
            "role": "MAIN"
          }
        ]
      },
      "role": "MAIN"
    }
  ]
}
```


### GET /v1/media/segments/{uuid}

Get segment by UUID

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `uuid` | string | yes | `example-id` |

**Response JSON (`200`):**

```json
{
  "uuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
  "position": 1133,
  "status": "ACTIVE",
  "startTimeMs": 2007255,
  "endTimeMs": 2008464,
  "contentRating": "SAFE",
  "episode": 1,
  "mediaId": 7674,
  "textJa": {
    "content": "僕は僕で、君は君だ。",
    "highlight": "string"
  },
  "textEn": {
    "content": "I am me, and you are you.",
    "isMachineTranslated": false,
    "highlight": "string"
  },
  "textEs": {
    "content": "Yo soy yo, y tú eres tú.",
    "isMachineTranslated": false,
    "highlight": "string"
  },
  "urls": {
    "imageUrl": "https://example.com/resource",
    "audioUrl": "https://example.com/resource",
    "videoUrl": "https://example.com/resource"
  }
}
```


### GET /v1/media/segments/{uuid}/context

Get surrounding context for a segment

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `uuid` | string | yes | `example-id` |

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `limit` | integer | no | `3` |
| `contentRating` | array | no | `["SAFE"]` |
| `include` | array | no | `["media"]` |

**Response JSON (`200`):**

```json
{
  "segments": [
    {
      "uuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
      "position": 1133,
      "status": "ACTIVE",
      "startTimeMs": 2007255,
      "endTimeMs": 2008464,
      "contentRating": "SAFE",
      "episode": 1,
      "mediaId": 7674,
      "textJa": {
        "content": "僕は僕で、君は君だ。",
        "highlight": "string"
      },
      "textEn": {
        "content": "I am me, and you are you.",
        "isMachineTranslated": false,
        "highlight": "string"
      },
      "textEs": {
        "content": "Yo soy yo, y tú eres tú.",
        "isMachineTranslated": false,
        "highlight": "string"
      },
      "urls": {
        "imageUrl": "https://example.com/resource",
        "audioUrl": "https://example.com/resource",
        "videoUrl": "https://example.com/resource"
      }
    }
  ],
  "includes": {
    "media": {
      "example": {
        "id": 7674,
        "externalIds": {
          "anilist": "21459",
          "imdb": "tt1234567",
          "tvdb": "12345"
        },
        "nameJa": "バクマン。",
        "nameRomaji": "Bakuman.",
        "nameEn": "Bakuman.",
        "airingFormat": "TV",
        "airingStatus": "FINISHED",
        "genres": [
          "Comedy",
          "Drama",
          "Romance",
          "Slice of Life"
        ],
        "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
        "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
        "startDate": "2010-10-02",
        "endDate": "2011-04-02",
        "category": "ANIME",
        "segmentCount": 0,
        "episodeCount": 25,
        "studio": "J.C.STAFF",
        "seasonName": "FALL",
        "seasonYear": 2010,
        "characters": [
          {
                          "id": 14545,
              "nameJa": "真城最高",
              "nameEn": "Moritaka Mashiro",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
            "seiyuu": {
              "id": 95991,
              "nameJa": "阿部敦",
              "nameEn": "Atsushi Abe",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
            },
            "role": "MAIN"
          }
        ]
      }
    }
  }
}
```


### GET /v1/media/seiyuu/{id}

Get seiyuu details

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `95991` |

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `include` | array | no | `["character"]` |

`character` is included by default when `include` is omitted.

**Response JSON (`200`):**

```json
{
  "id": 95991,
  "nameJa": "阿部敦",
  "nameEn": "Atsushi Abe",
  "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg",
  "characters": [
    {
      "id": 14545,
      "nameJa": "真城最高",
      "nameEn": "Moritaka Mashiro",
      "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
      "media": {
        "id": 7674,
        "externalIds": {
          "anilist": "21459",
          "imdb": "tt1234567",
          "tvdb": "12345"
        },
        "nameJa": "バクマン。",
        "nameRomaji": "Bakuman.",
        "nameEn": "Bakuman.",
        "airingFormat": "TV",
        "airingStatus": "FINISHED",
        "genres": [
          "Comedy",
          "Drama",
          "Romance",
          "Slice of Life"
        ],
        "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
        "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
        "startDate": "2010-10-02",
        "endDate": "2011-04-02",
        "category": "ANIME",
        "segmentCount": 0,
        "episodeCount": 25,
        "studio": "J.C.STAFF",
        "seasonName": "FALL",
        "seasonYear": 2010,
        "characters": []
      },
      "role": "MAIN"
    }
  ]
}
```


### GET /v1/media/series

List all series

**Auth:** API key (Bearer token) or Session cookie

**Query parameters:**

| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `limit` | integer | no | `20` | max `100` |
| `cursor` | integer | no | `0` | pagination offset |
| `query` | string | no | - | case-insensitive filter across `nameEn` / `nameJa` / `nameRomaji` |

**Response JSON (`200`):**

```json
{
  "series": [
    {
      "id": 1,
      "nameJa": "バクマン。シリーズ",
      "nameRomaji": "Bakuman. Series",
      "nameEn": "Bakuman Series"
    }
  ],
  "pagination": {
    "hasMore": false,
    "cursor": null
  }
}
```


### POST /v1/media/series

Create series

**Auth:** API key (Bearer token)

**Request JSON:**

```json
{
  "nameJa": "バクマン。シリーズ",
  "nameRomaji": "Bakuman. Series",
  "nameEn": "Bakuman Series"
}
```

**Response JSON (`201`):**

```json
{
  "id": 1,
  "nameJa": "バクマン。シリーズ",
  "nameRomaji": "Bakuman. Series",
  "nameEn": "Bakuman Series"
}
```


### GET /v1/media/series/{id}

Get series details

**Auth:** API key (Bearer token) or Session cookie

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |

**Query parameters:**

| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `include` | string[] | no | `["media"]` | supports `media` and `media.characters` |

Use `include=["media.characters"]` to include character/seiyuu data for each media entry.

**Response JSON (`200`):**

```json
{
  "id": 1,
  "nameJa": "バクマン。シリーズ",
  "nameRomaji": "Bakuman. Series",
  "nameEn": "Bakuman Series",
  "media": [
    {
      "position": 1,
      "media": {
        "id": 7674,
        "externalIds": {
          "anilist": "21459",
          "imdb": "tt1234567",
          "tvdb": "12345"
        },
        "nameJa": "バクマン。",
        "nameRomaji": "Bakuman.",
        "nameEn": "Bakuman.",
        "airingFormat": "TV",
        "airingStatus": "FINISHED",
        "genres": [
          "Comedy",
          "Drama",
          "Romance",
          "Slice of Life"
        ],
        "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
        "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
        "startDate": "2010-10-02",
        "endDate": "2011-04-02",
        "category": "ANIME",
        "segmentCount": 0,
        "episodeCount": 25,
        "studio": "J.C.STAFF",
        "seasonName": "FALL",
        "seasonYear": 2010,
        "characters": [
          {
                          "id": 14545,
              "nameJa": "真城最高",
              "nameEn": "Moritaka Mashiro",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
            "seiyuu": {
              "id": 95991,
              "nameJa": "阿部敦",
              "nameEn": "Atsushi Abe",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
            },
            "role": "MAIN"
          }
        ]
      }
    }
  ]
}
```


### PATCH /v1/media/series/{id}

Update series metadata

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |

**Request JSON:**

```json
{
  "nameJa": "更新バクマン。シリーズ",
  "nameRomaji": "Updated Bakuman. Series",
  "nameEn": "Updated Bakuman Series"
}
```

**Response JSON (`200`):**

```json
{
  "id": 1,
  "nameJa": "バクマン。シリーズ",
  "nameRomaji": "Bakuman. Series",
  "nameEn": "Bakuman Series"
}
```


### DELETE /v1/media/series/{id}

Delete series

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |

**Response:** `204` (no JSON body)


### POST /v1/media/series/{id}/media

Add media to series

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |

**Request JSON:**

```json
{
  "mediaId": 42,
  "position": 1
}
```

**Response:** `204` (no JSON body)


### PATCH /v1/media/series/{id}/media/{mediaId}

Update media position in series

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |
| `mediaId` | integer | yes | `42` |

**Request JSON:**

```json
{
  "position": 2
}
```

**Response:** `204` (no JSON body)


### DELETE /v1/media/series/{id}/media/{mediaId}

Remove media from series

**Auth:** API key (Bearer token)

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `1` |
| `mediaId` | integer | yes | `42` |

**Response:** `204` (no JSON body)


---

## User

### GET /v1/user/activity

Get user activity history

**Auth:** Session cookie

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `cursor` | integer | no | `1` |
| `limit` | integer | no | `20` |
| `activityType` | string | no | `SEARCH` |

**Response JSON (`200`):**

```json
{
  "activities": [
    {
      "id": 1,
      "activityType": "SEARCH",
      "segmentUuid": "example-id",
      "mediaId": 1,
      "searchQuery": "string",
      "createdAt": "2026-02-19T10:30:00.000Z"
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": 1
  }
}
```


### DELETE /v1/user/activity

Clear user activity history

**Auth:** Session cookie

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `activityType` | string | no | `SEARCH` |

**Response JSON (`200`):**

```json
{
  "message": "string",
  "deletedCount": 1
}
```


### GET /v1/user/activity/stats

Get user activity statistics

**Auth:** Session cookie

**Response JSON (`200`):**

```json
{
  "totalSearches": 1,
  "totalExports": 1,
  "totalPlays": 1,
  "totalListAdds": 1,
  "streakDays": 1,
  "topMedia": [
    {
      "mediaId": 1,
      "count": 1
    }
  ]
}
```


### GET /v1/user/export

Export all user data

**Auth:** Session cookie

**Response JSON (`200`):**

```json
{
  "profile": {
    "id": 42,
    "username": "john_doe",
    "email": "john@example.com",
    "createdAt": "2026-02-19T10:30:00.000Z"
  },
  "preferences": {
    "labs": {
      "segmentConcatenation": true
    },
    "mediaNameLanguage": "english",
    "contentRatingPreferences": {
      "suggestive": "show",
      "explicit": "blur"
    },
    "searchHistory": {
      "enabled": true
    }
  },
  "activity": [
    {
      "id": 501,
      "activityType": "SEARCH",
      "segmentUuid": null,
      "mediaId": null,
      "searchQuery": "彼女",
      "createdAt": "2026-02-19T10:30:00.000Z"
    }
  ],
  "collections": [
    {
      "id": 123,
      "name": "Study Favorites",
      "userId": 42,
      "visibility": "PRIVATE",
      "segmentUuids": [
        "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e"
      ]
    }
  ],
  "reports": [
    {
      "id": 11,
      "source": "USER",
      "target": {
        "type": "SEGMENT",
        "mediaId": 7674,
        "episodeNumber": 1,
        "segmentUuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e"
      },
      "reviewCheckRunId": null,
      "reason": "WRONG_TIMING",
      "description": "Subtitle timing seems late in this line.",
      "data": null,
      "status": "PENDING",
      "adminNotes": null,
      "userId": 42,
      "createdAt": "2026-02-19T10:30:00.000Z",
      "updatedAt": null
    }
  ]
}
```


### GET /v1/user/labs

List lab features with user opt-in status

**Auth:** Session cookie

**Response JSON (`200`):**

```json
[
  {
    "key": "string",
    "name": "string",
    "description": "string",
    "enabled": true,
    "userEnabled": true
  }
]
```


### GET /v1/user/preferences

Get user preferences

**Auth:** Session cookie

**Response JSON (`200`):**

```json
{
  "labs": {
    "example": true
  },
  "mediaNameLanguage": "english",
  "contentRatingPreferences": {
    "suggestive": "show",
    "explicit": "show"
  },
  "searchHistory": {
    "enabled": true
  },
  "blogLastVisited": "2026-02-19T10:30:00.000Z"
}
```


### PATCH /v1/user/preferences

Update user preferences

**Auth:** Session cookie

**Request JSON:**

```json
{
  "labs": {
    "example": true
  },
  "mediaNameLanguage": "english",
  "contentRatingPreferences": {
    "suggestive": "show",
    "explicit": "show"
  },
  "searchHistory": {
    "enabled": true
  },
  "blogLastVisited": "2026-02-19T10:30:00.000Z"
}
```

**Response JSON (`200`):**

```json
{
  "labs": {
    "example": true
  },
  "mediaNameLanguage": "english",
  "contentRatingPreferences": {
    "suggestive": "show",
    "explicit": "show"
  },
  "searchHistory": {
    "enabled": true
  },
  "blogLastVisited": "2026-02-19T10:30:00.000Z"
}
```


### GET /v1/user/quota

Get current monthly API quota

**Auth:** Session cookie or API key (Bearer token)

**Response JSON (`200`):**

```json
{
  "quotaUsed": 342,
  "quotaLimit": 2500,
  "quotaRemaining": 2158,
  "periodYyyymm": 202602,
  "periodStart": "2026-02-01T00:00:00.000Z",
  "periodEnd": "2026-02-28T23:59:59.999Z"
}
```


### GET /v1/user/reports

List user's own reports

**Auth:** Session cookie

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `cursor` | integer | no | `1` |
| `limit` | integer | no | `20` |
| `status` | string | no | `PENDING` |

**Response JSON (`200`):**

```json
{
  "reports": [
    {
      "id": 1,
      "source": "USER",
      "target": {
        "type": "SEGMENT",
        "mediaId": 42,
        "episodeNumber": 5,
        "segmentUuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e"
      },
      "reviewCheckRunId": 1,
      "reason": "WRONG_TRANSLATION",
      "description": "string",
      "data": {
        "example": "value"
      },
      "status": "PENDING",
      "adminNotes": "string",
      "userId": 42,
      "createdAt": "2026-02-19T10:30:00.000Z",
      "updatedAt": "2026-02-19T10:30:00.000Z"
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": 10
  }
}
```


### POST /v1/user/reports

Create a new report

**Auth:** Session cookie

**Request JSON:**

```json
{
  "target": {
    "type": "SEGMENT",
    "mediaId": 42,
    "segmentUuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e"
  },
  "reason": "WRONG_TRANSLATION",
  "description": "The translation doesn't match the spoken Japanese"
}
```

**Response JSON (`201`):**

```json
{
  "id": 1,
  "source": "USER",
  "target": {
    "type": "SEGMENT",
    "mediaId": 42,
    "episodeNumber": 5,
    "segmentUuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e"
  },
  "reviewCheckRunId": 1,
  "reason": "WRONG_TRANSLATION",
  "description": "string",
  "data": {
    "example": "value"
  },
  "status": "PENDING",
  "adminNotes": "string",
  "userId": 42,
  "createdAt": "2026-02-19T10:30:00.000Z",
  "updatedAt": "2026-02-19T10:30:00.000Z"
}
```


---

## Collections

### GET /v1/collections

List user's collections

**Auth:** Session cookie

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `visibility` | string | no | `private` |
| `cursor` | integer | no | `0` |
| `page` | integer | no | `1` |
| `limit` | integer | no | `20` |

**Response JSON (`200`):**

```json
{
  "collections": [
    {
      "id": 123,
      "name": "Study Favorites",
      "userId": 1,
      "visibility": "PRIVATE"
    }
  ],
  "pagination": {
    "hasMore": true,
    "cursor": 20
  }
}
```


### POST /v1/collections

Create collection

**Auth:** Session cookie

**Request JSON:**

```json
{
  "name": "My Study List",
  "visibility": "PRIVATE"
}
```

**Response JSON (`201`):**

```json
{
  "id": 123,
  "name": "Study Favorites",
  "userId": 1,
  "visibility": "PRIVATE"
}
```


### GET /v1/collections/{id}

Get collection details

**Auth:** Session cookie

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `123` |

**Query parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `cursor` | integer | no | `0` |
| `page` | integer | no | `1` |
| `limit` | integer | no | `20` |

**Response JSON (`200`):**

```json
{
  "id": 123,
  "name": "Study Favorites",
  "userId": 1,
  "visibility": "PRIVATE",
  "segments": [
    {
      "position": 1,
      "note": "string",
      "result": {
        "uuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
        "position": 1133,
        "status": "ACTIVE",
        "startTimeMs": 2007255,
        "endTimeMs": 2008464,
        "contentRating": "SAFE",
        "episode": 1,
        "mediaId": 7674,
        "textJa": {
          "content": "僕は僕で、君は君だ。",
          "highlight": "string"
        },
        "textEn": {
          "content": "I am me, and you are you.",
          "isMachineTranslated": false,
          "highlight": "string"
        },
        "textEs": {
          "content": "Yo soy yo, y tú eres tú.",
          "isMachineTranslated": false,
          "highlight": "string"
        },
        "urls": {
          "imageUrl": "https://example.com/resource",
          "audioUrl": "https://example.com/resource",
          "videoUrl": "https://example.com/resource"
        }
      }
    }
  ],
  "includes": {
    "media": {
      "example": {
        "id": 7674,
        "externalIds": {
          "anilist": "21459",
          "imdb": "tt1234567",
          "tvdb": "12345"
        },
        "nameJa": "バクマン。",
        "nameRomaji": "Bakuman.",
        "nameEn": "Bakuman.",
        "airingFormat": "TV",
        "airingStatus": "FINISHED",
        "genres": [
          "Comedy",
          "Drama",
          "Romance",
          "Slice of Life"
        ],
        "coverUrl": "https://cdn.example.com/media/anime/bakuman/cover.webp",
        "bannerUrl": "https://cdn.example.com/media/anime/bakuman/banner.webp",
        "startDate": "2010-10-02",
        "endDate": "2011-04-02",
        "category": "ANIME",
        "segmentCount": 0,
        "episodeCount": 25,
        "studio": "J.C.STAFF",
        "seasonName": "FALL",
        "seasonYear": 2010,
        "characters": [
          {
                          "id": 14545,
              "nameJa": "真城最高",
              "nameEn": "Moritaka Mashiro",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/character/large/b14545.jpg",
            "seiyuu": {
              "id": 95991,
              "nameJa": "阿部敦",
              "nameEn": "Atsushi Abe",
              "imageUrl": "https://s4.anilist.co/file/anilistcdn/staff/large/n95991.jpg"
            },
            "role": "MAIN"
          }
        ]
      }
    }
  },
  "totalCount": 42,
  "pagination": {
    "hasMore": true,
    "cursor": 20
  }
}
```


### PATCH /v1/collections/{id}

Update collection metadata

**Auth:** Session cookie

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `123` |

**Request JSON:**

```json
{
  "name": "Updated Collection Name",
  "visibility": "PUBLIC"
}
```

**Response JSON (`200`):**

```json
{
  "id": 123,
  "name": "Study Favorites",
  "userId": 1,
  "visibility": "PRIVATE"
}
```


### DELETE /v1/collections/{id}

Delete collection

**Auth:** Session cookie

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `123` |

**Response:** `204` (no JSON body)


### POST /v1/collections/{id}/segments

Add segment to collection

**Auth:** Session cookie

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `123` |

**Request JSON:**

```json
{
  "segmentUuid": "3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e",
  "note": "string"
}
```

**Response:** `204` (no JSON body)


### PATCH /v1/collections/{id}/segments/{uuid}

Update segment in collection

**Auth:** Session cookie

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `123` |
| `uuid` | string | yes | `3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e` |

**Request JSON:**

```json
{
  "position": 2,
  "note": "string"
}
```

**Response:** `204` (no JSON body)


### DELETE /v1/collections/{id}/segments/{uuid}

Remove segment from collection

**Auth:** Session cookie

**Path parameters:**

| Name | Type | Required | Example |
|------|------|----------|---------|
| `id` | integer | yes | `123` |
| `uuid` | string | yes | `3fd94cef-a3e1-31ae-bc8d-e743f03e9c7e` |

**Response:** `204` (no JSON body)

---

## Notes

- This file focuses on concrete request/response JSON payloads for implemented endpoints.
- For full error code catalogs and validation constraints, use `docs/generated/openapi.yaml`.

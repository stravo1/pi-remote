---
name: web-search
description: Search the web and read web pages. Use when a task needs current information, documentation, release notes, or facts you do not know.
---

# Web search

Search with the local SearXNG server. URL-encode the query:

```sh
curl -s "http://127.0.0.1:8888/search?format=json&q=<url-encoded query>" \
  | jq -r ".results[:8][] | \"\(.title)\n\(.url)\n\(.content)\n\""
```

To read a result, fetch it and strip the HTML:

```sh
curl -sL --max-time 20 "<url>" | sed -e "s/<[^>]*>//g" | tr -s " \n" | head -c 20000
```

Search again with different words when the results are weak. Cite the URLs you used in your answer.

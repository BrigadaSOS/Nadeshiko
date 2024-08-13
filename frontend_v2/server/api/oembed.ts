import { defineEventHandler } from 'h3'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const { desc, user, link, ttype } = query

  const appName = 'Nadeshiko'
  const repoUrl = 'https://dev.nadeshiko.co'

  return {
    type: ttype || 'video',
    version: '1.0',
    provider_name: appName,
    provider_url: repoUrl,
    title: desc,
    author_name: user,
    author_url: link
  }
})
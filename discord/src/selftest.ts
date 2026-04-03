import { EmbedBuilder, REST, Routes, type APIEmbed } from 'discord.js';
import { BOT_CONFIG } from './config';
import { search, getSegmentContext, getStats } from './api';
import { buildSearchResultMessages, buildContextMessage, buildSegmentMessage, buildStatsEmbed } from './embeds';

const BOT_TOKEN = BOT_CONFIG.token;
const TEST_CHANNEL_ID = process.env.TEST_CHANNEL_ID ?? '1484857703128891412';

async function sendToChannel(label: string, options: { content?: string; embeds?: EmbedBuilder[] }) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

  console.log(`--- ${label} ---`);

  const body: { content?: string; embeds?: APIEmbed[] } = {};
  if (options.content) body.content = `**Self-test: ${label}**\n${options.content}`;
  else body.content = `**Self-test: ${label}**`;
  if (options.embeds) body.embeds = options.embeds.map((e) => e.toJSON());

  await rest.post(Routes.channelMessages(TEST_CHANNEL_ID), { body });
  console.log('  Sent!');
}

async function testSearch() {
  console.log('\n[1/4] Testing /search...');
  const result = await search('食べる', { take: 3 });
  console.log(`  Found ${result.pagination.estimatedTotalHits} results, showing ${result.segments.length}`);

  const [content] = buildSearchResultMessages(result, '食べる');
  await sendToChannel('/search 食べる', { content });
}

async function testRandom() {
  console.log('\n[2/4] Testing /random (with video)...');
  const result = await search('*', { take: 1, sort: 'RANDOM', seed: 42 });

  if (result.segments.length > 0) {
    const seg = result.segments[0];
    const media = result.includes.media[seg.mediaPublicId];
    console.log(`  Random segment: ${seg.textJa.content.slice(0, 40)}...`);

    const content = buildSegmentMessage(seg, media);
    await sendToChannel('/random', { content });
  }
}

async function testContext() {
  console.log('\n[3/4] Testing /context...');
  const searchResult = await search('食べる', { take: 1 });
  if (searchResult.segments.length === 0) {
    console.log('  Skipped (no segments to get context for)');
    return;
  }

  const targetId = searchResult.segments[0].publicId;
  console.log(`  Getting context for segment ${targetId}...`);

  const contextResult = await getSegmentContext(targetId, 5);
  console.log(`  Got ${contextResult.segments.length} context segments`);

  const content = buildContextMessage(contextResult, targetId);
  await sendToChannel(`/context ${targetId}`, { content });
}

async function testStats() {
  console.log('\n[4/4] Testing /stats...');
  const stats = await getStats();
  console.log(`  Corpus: ${stats.totalSegments} segments, ${stats.totalMedia} media`);

  const embed = buildStatsEmbed(stats);
  await sendToChannel('/stats', { embeds: [embed] });
}

async function main() {
  console.log('Nadeshiko Discord Bot - Self Test');
  console.log(`API: ${BOT_CONFIG.apiBaseUrl}`);
  console.log(`Channel: ${TEST_CHANNEL_ID}`);

  try {
    await testSearch();
    await testRandom();
    await testContext();
    await testStats();
    console.log('\nAll tests passed!');
  } catch (error) {
    console.error('\nTest failed:', error);
    process.exit(1);
  }
}

main();

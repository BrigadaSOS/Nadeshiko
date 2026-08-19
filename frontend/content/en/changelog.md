---
title: "Changelog"
description: "What shipped in each version of Nadeshiko, newest first."
---

# Changelog

What's new in Nadeshiko, newest first. The version in the footer is the release you are on, and it brings you here.

We only list what you can see. Work behind a lab or a feature flag stays off this page until it is on for everyone, and dependency bumps, refactors and CI never appear at all. For the commit-level history, see the [releases on GitHub](https://github.com/BrigadaSOS/Nadeshiko/releases).

## 2.4.3 (2026-08-20)

### Fixes

- **Sentences**: a link with a malformed id now says the sentence was not found, instead of showing an error page. 2.4.2 fixed this for ids that were the right shape but no longer existed; an id of the wrong shape entirely — `/sentence/13123123123` — is rejected before we ever look it up, and that case was still reporting a fault on our side. The same applied to titles and collections.
- **Menus on phones**: the menus behind the buttons under each sentence — Add, Save, Copy and the overflow — now stay on screen. Copy sits far enough to the right that its menu ran off the edge of a phone, so part of it could not be read or tapped, and the same anchoring left the others with an odd gap on one side. The sort menu in the search filters and the one on the media page had the same problem.

## 2.4.2 (2026-08-20)

### Highlights

- **Blog**: an RSS feed, one per language, linked from the blog itself so a reader finds it without guessing an address.
- **Wording**: one name per thing, throughout. A show, film or channel is a "title" — it had also been called content, media and a show, sometimes on the same screen. A result is a "sentence", where parts of the site said segment, clip or line. And signing in is "sign in", "sign up" and "sign out", instead of three different verbs inside the same flow.

### Fixes

- **Search**: a search for something that is not a word now finds nothing, which is the right answer. A run of consonants returned thousands of unrelated sentences with every word highlighted as though it had matched, and two different strings of nonsense returned identical results — the text was being thrown away before the search ran.
- **Sentences**: a link to a sentence that no longer exists now says the sentence was not found, instead of showing an error page. Every dead permalink was being reported as a fault on our side.
- **Language**: switching language on About, Privacy, Terms, DMCA, the changelog or any blog post no longer lands on "page not found". Opening the same address directly had always worked, which is what made this easy to miss.
- **Share previews**: a link to a title unfurls with its banner at the right shape. The size we declared did not match the image, so the preview came out cropped.
- **Blog**: previews on the index no longer swallow text written in angle brackets — the v2.1.0 post's `/search <word>` had lost its argument — and their bullet spacing is fixed.
- **Dates**: a date reads the same wherever you are. The stats page showed one day for a moment and then corrected itself to another.
- **DMCA**: the list of what a takedown notice must contain had its headings one step out of line with the text beneath them, so anyone following the bold labels would have filed an invalid notice.
- **Privacy policy**: it asked you twice to get in touch without giving an address, described push notifications from a mobile app that does not exist, and understated who handles your data. All three are corrected, and there is a contact section.
- **Home**: the sentence total was rounded up behind a "+", so it claimed more than the real figure; it is now rounded down and written the same way as on the stats page. "Over 1 million sentences" was a third short of what is actually there.
- **Japanese and Spanish**: two English words in the menus, an English heading on the About page in every language, and the missing accents on the Spanish home page.
- **Audio player**: every button now says what it does to a screen reader. Eight of the nine were silent, so the player could be opened and not operated.
- **Reading**: long pages are set to a readable width rather than the full window, where a line could run to about 160 characters and the last of it slid under the feedback button. The coverage figures on the stats page are legible against the background, and Tab now reaches a "skip to content" link before the eleven controls in the header.

## 2.4.1 (2026-08-20)

### Fixes

- **Site**: a deploy no longer blocks the page you already have open. Every file we build is fingerprinted, and your browser refuses to run one whose fingerprint does not match what your page expects. Two builds were reusing the same filenames for files whose contents differed, so a tab open across a deploy asked for a file it knew and was handed a different one, which it then refused: the page stopped responding until you reloaded it. Each build now keeps its files apart from every other build's, so the page you have open keeps finding exactly the files it was built with. An open tab also notices a new version within about five minutes instead of an hour.
- **Discord**: the invite link on the site, in the about page, in the footer and in the bot itself now works. The old one had expired, so every one of them led to a dead page.

## 2.4.0 (2026-08-19)

### Highlights

- **Word card**: click any word in a sentence and read it without leaving the page: the dictionary form and its reading, numbered definitions, the pitch-accent diagram and its recording, and the Common, JLPT and frequency badges. A word that could be more than one thing offers you the alternatives rather than picking one silently, and a compound opens its parts.
- **Your own dictionaries**: link a Shirabe account and the word card reads your stack rather than ours, monolingual packs included, and anything you have uploaded from Yomitan. It keeps in step when you reorder it over there, and you can resync or disconnect whenever you like.
- **Anki**: mine a word, not just the sentence it came from. A word card tells you whether that word is already in your collection, opens its note in Anki, and puts this sentence, its audio and its image onto that note, or onto a new card when the word is new to you. A word you had already filed in some other deck no longer fails as a duplicate; the note you already have is offered instead.
- **Anki**: the word's own content goes onto the note too: the dictionary form, its reading, furigana in Anki's `漢字[かんじ]` notation, the numbered definitions in the languages you read, the pitch-accent diagram, its recording, the accent position as a plain number, and the badges. Each is its own placeholder, so you choose which of them your note type gets.
- **Anki**: a field per dictionary. "Definition" is your whole stack, while the placeholder menu also lists your linked dictionaries by name, so a note type can keep 三省堂 in one field and JMdict in another, and a "first dictionary" placeholder follows whatever you move to the top. On a card built from more than one, clicking a dictionary's name ticks it and the note is written from what you ticked.
- **Anki**: notes that look like the card they came from. The definition arrives as numbered senses with the part of speech and usage tag as coloured chips, instead of one unbroken run of text; the mined word is marked with a plain `<b>` your note type can style; and a new "Japanese sentence (word marked)" field keeps the sentence with that word highlighted inside it, so a card you review weeks later still says which word it was about.
- **Anki settings**: picking a deck fills in the note type that deck is mostly made of, so a fresh setup is one dropdown instead of two. The page says "Saved" when it has saved, and "Open Anki browser when exporting a card" now stays off when you turn it off. The server had been dropping that value on every save.
- **Search**: your recent searches, under the search bar. The list narrows as you type, a cross on a row forgets it, and Clear empties it. Signed out it stays on this device; signed in it follows you between devices. A search you ran inside one show is kept as its own entry, labelled with the title, and re-running it takes you back into that show.
- **Search**: star the titles you care about and they sort to the top of the media filter, up to 100 of them. The shows you actually study sort up it too, worked out from the cards you export, the clips you play and the lines you share. Results from either rank a little higher, a nudge rather than a takeover, so a better sentence from a show you have never seen still beats a worse one from a show you have.
- **Search**: titles and episodes are one filter panel now: picking a title drills into its episodes, and the header of that level is the way back out. A title you pick gets its own tab beside All, and All stays on screen, so a show with no hits for your word no longer looks like the search itself finding nothing. The category tabs and the English, Spanish and furigana controls stay at the top while you read down the results.
- **Search**: a line above the results says how many hits your own hidden titles and categories kept out of them, names those titles if you ask, and offers to show them for this search or to go change the list.
- **Search**: a line you report stops appearing in results and a title you report drops down them, until we have dealt with the report. The line goes because a wrong subtitle has nothing worth ranking; the title only sinks, because a wrong cover or a wrong name says nothing about whether its subtitles are good. Everything comes back the moment the report is fixed or dismissed.
- **Settings**: choose the category searches open on, so a reader who only watches anime lands on the Anime tab without clicking it. An Animations setting with "Match my device", "Reduced" and "None", working signed out and applying from the first frame. And favouriting and hiding titles are one Media tab now, one card with one search box over it, rather than two pages and three stacked panels.
- **Activity**: "Remember which shows I study" is its own switch beside search history, with everything it has tallied listed in full and its own Forget button, so you can keep one without the other, and forget a single title the tally read wrong.
- **Account**: activity, collections and settings have screens of their own, and your data export covers the tally of titles you study.
- **Media**: every title has a page at its own URL, linking out to AniList, TMDB, IMDb or YouTube wherever we have the id.
- **API**: a key is created with the permissions you pick: read-only, full account access, or a list you choose yourself. Read-only is the default, where a key used to get everything the account can do. A third-party app can now call the search and media endpoints straight from a browser, and read the rate-limit headers so it slows down before it is throttled.
- **Site**: a feedback widget anyone can send from, the Discord bot on the front page with a link to add it to your server, and this changelog, linked from the version number in the footer.

### Fixes

- **Sentence**: expanding a sentence keeps its words clickable. Furigana, word cards and the furigana in an Anki export all disappeared the moment you pulled in the line before or after. The pulled-in lines are tinted so you can still see which one was the hit.
- **Search**: clicking a word now does what typing it always did: one search rather than two identical ones, run inside the show you are reading rather than dropping you back out into everything, with the bar showing the word you are actually looking at rather than the previous one. Clicking a title or an episode on a result keeps your word instead of turning the search into a browse of everything that title has.
- **Search**: on a phone the filter drawer scrolls in one place with its header staying put, instead of a list scrolling inside a drawer that was scrolling as well. Below tablet width the search box takes back the width of the two buttons beside it, with the keyboard's Go key submitting; on every width the tabs and language controls sit clear of the bar rather than pressed against it.
- **Anki**: an Anki entry in a sentence's menu that cannot act says why: Anki not configured, Anki not running, or, for the export that searches your collection, no Key Field set. Adding to your last added card does not need a Key Field and never has.
- **Activity**: a search that arrives from a shared link, a reload or a dictionary extension is recorded in your history (only searches typed into the box were, which was the minority of them), and running the same search again keeps one entry for the day rather than filling the history with the same line over and over. A search run inside one title is listed with that title and links back into it.
- **Settings**: a preference you have just changed no longer comes back at its old value when you reload the page, and a title whose Japanese and romaji names are the same is listed once rather than as "DEATH NOTE | DEATH NOTE".
- **Site**: the about, privacy, terms and DMCA pages run at the same width as the rest of the site instead of a narrower column of their own.
- **Discord bot**: the invite asks for the permissions the bot actually uses, so a fresh install can attach its clips and use its own emoji.

## 2.3.7 (2026-08-13)

### Fixes

- **Site**: a deploy no longer breaks the page you already have open. Your browser checks each file it loads against a fingerprint we publish, and we were rewriting those files after the fingerprint was stamped, so the two disagreed and the tab stopped loading anything new.

## 2.3.6 (2026-08-13)

### Fixes

- **Site**: deploying while you are reading no longer strands the tab. The files from the previous build stay available, so a page you have open keeps finding what it asks for instead of erroring on the next click.
- **Site**: a page that fails to fetch part of itself gets a fresh retry each time you reload, instead of spending every attempt in one go and leaving you on a blank screen.
- **Sentence**: expanding a sentence you had already played builds the longer audio, instead of handing back the original clip in playback and in what you mined to Anki. Clicking expand while it is still building is no longer swallowed without a sign.
- **Search**: word cards no longer show the dictionary's own example sentences, so a card is the word rather than a page of other people's lines.
- **Settings**: the token popup reading setting is gone. Readings are shown in hiragana for everyone, rather than in whichever of hiragana, katakana, romaji or nothing you had picked.

## 2.3.5 (2026-08-13)

### Highlights

- **Search**: word cards. Clicking a word in a sentence opens what the dictionary has on it, with audio for each pitch accent, and the word you clicked marked in the line it came from.
- **Settings**: hide whole categories of media. Anime, drama, YouTube and the rest each get a switch, the media grid respects it, and search stops asking for what you have hidden rather than filtering it out afterwards. You cannot hide the last category you have left.

### Fixes

- **Sentence**: the context window scrolls itself instead of scrolling the page behind it.
- **Activity**: an entry whose media has no name no longer takes the whole activity feed down with it.
- **Search**: jiten.moe joins the dictionary links offered on a word.
- **Search**: a search address with broken escaping shows results instead of an error page. `/search/%E8%AD` used to answer a plain 500, and a query that cannot be read now sends you back to search.

## 2.3.4 (2026-08-13)

### Fixes

- **Search**: a word you exclude with a leading dash is excluded from every language a sentence is matched in, not just one, so `"ズレ" -ズレて` no longer returns ずれてる.
- **Site**: being sent to your language when you open nadeshiko.co now happens at Cloudflare rather than at our server. From Tokyo that redirect was costing about 1.2 seconds before the page had started.

## 2.3.3 (2026-08-13)

### Highlights

- **API**: a service key can work the report queue, so reports can be listed and resolved with a key instead of a signed-in session.

### Fixes

- **Search**: hiding more than 100 titles no longer breaks search for you. Past 100, every search you ran came back an error while the same search worked signed out. The limit is 1,000.
- **Site**: a tab left open across a deploy recovers itself, rather than failing every part of the page it goes on to ask for and sitting half-rendered for the rest of the visit.
- **Anki**: mining tells you Anki is not running instead of failing on nothing. With Anki closed, the add-on disabled or the connection refused, the site was reading an answer that never arrived.
- **Account**: the active sessions list works whenever you are signed in. It refused anyone whose session was more than a day old, which is nearly everyone, since sessions last 30 days.
- **Site**: pressing Enter to confirm an IME conversion no longer submits what you are typing, in the search box, the sidebar search, or a collection, Anki profile or API key name.
- **Settings**: shirabe.org leads the dictionary links, in settings and in the row on a word, rather than sitting third behind entries you can switch off.

## 2.3.1 (2026-08-10)

*Groundwork for the word card, which was still switched off, and the last of the move to one shared Elasticsearch server. Nothing you would have noticed.*

## 2.3.0 (2026-08-10)

### Highlights

- **Settings**: the Shirabe dictionary link is shirabe.org, on by default, and opens the word in the language you read the site in. It used to be a `shirabelookup://` link that did nothing unless you had the app installed. Jisho stays, but is no longer on by default.
- **API**: `Token` in a search response drops `wid` and the UniDic slots `p1`, `p2`, `p4` and `cf`. `posLabel` already says in words what those were kept to say.

### Fixes

- **Site**: the site is findable in search engines again. A `robots.txt` committed by accident in April 2026 alongside a blog post's images told every crawler to stay off the whole site, and production had been deindexed since.
- **Search**: hiding a show no longer empties the other category tabs. The counts were rebuilt from the media list, which only covers the tab you are on, so hiding one anime left anime as the only tab and collapsed the "All" total onto it.
- **Search**: an answer to a search you have already moved on from is dropped instead of landing on the page. Typing on, or changing a filter, cancels the request it replaces rather than racing it.
- **Media**: One Punch Man's sentences are readable again. 2,044 of its 3,149 lines were stored with a space between every word (`近い ぞ ! !　誰か い ない の か ! ?`), and they are repaired and re-tokenized, so でしょう is one word again instead of でしょ plus う.
- **Collections**: a private collection is only readable by its owner. A server render fetched it with the site's own key rather than with your session, so a link to someone else's private collection filled in.
- **Site**: the per-visitor request limit counts you, not the Cloudflare machine your traffic left through, so you can no longer be told to slow down for someone else's browsing.
- **Site**: when something fails to load, you are told so in your language, instead of the page simply not changing. "Couldn't load your collections", "Couldn't load your API keys", "Too many requests, please wait a moment and try again" and the rest.
- **Site**: dialogs behave like dialogs. Escape closes the one on top, the keyboard stays inside it while it is open, and focus returns to whatever you opened it from. The report, batch search, Anki notes, keyboard shortcuts and context windows all went through the rebuild.
- **Media**: typing in the media filter and then leaving no longer drags you back to the media page a moment later.
- **Site**: more of the interface is translated, including the labels screen readers announce and the wording of failures, with a check that keeps English, Spanish and Japanese from drifting apart again.

## 2.2.2 (2026-07-25)

### Fixes

- **Site**: a page that does not exist now shows the error page. It used to bounce between localized URLs until the browser gave up.
- **Site**: one machine hammering the site can no longer slow it down for everyone. Page loads and API calls are capped per address per minute, and a service key is exempt so integrations are not caught by it.
- **Media**: a YouTube channel's cover is calmer. The channel picture sits as a circle on a soft blur of itself instead of the oversaturated wash it had.

## 2.2.1 (2026-06-20)

### Highlights

- **Sentence**: copy a Japanese sentence with its furigana. It lands in the clipboard in Anki's `漢字[かんじ]` form, ready to paste into a card.
- **Search**: the show list and episode list in the sidebar are wider, stretch to the height of the window, and wrap a long show name onto a second line instead of cutting it off.

### Fixes

- **Search**: YouTube gets its own tab next to Anime and Live Action. Its results were already in the "All" tab, but there was no way to narrow to them.
- **Search**: a YouTube result plays where it sits instead of failing to start. It also plays on iOS, where the embed used to refuse, and the player is stripped of YouTube's own controls, share and watch-later buttons.
- **Search**: clicking the screenshot on a YouTube result opens the image again, as it does everywhere else. The play button starts the video.
- **Search**: picking a show or an episode from the filters takes you back to the top of the results instead of leaving you halfway down the ones you were reading.
- **Search**: the episode list went back to its own fixed box. Widening the sidebar had let it stretch down the whole column.
- **Media**: YouTube channels get their own card style, with the channel picture over a blurred background rather than being stretched like a poster.
- **Site**: switching language mid-visit loads its wording again. The request for the translation file was being caught by the language redirect and sent somewhere that did not exist.

## 2.2.0 (2026-06-18)

### Highlights

- **Media**: YouTube support. Channels join anime and drama as something you can search, with the channel's videos in place of episodes and its own filter on the media page.
- **Search**: a YouTube result plays in place. The screenshot swaps for the video at the exact second the sentence is spoken, without leaving the page.
- **Search**: a YouTube result carries a link to the video on YouTube, opened at that same second, where an anime result would show its episode number.
- **Media**: a channel's page counts videos rather than episodes, and links out to the channel on YouTube.

## 2.1.2 (2026-06-14)

### Fixes

- **Site**: dark-mode browser extensions no longer lay a filter over pages that were already dark. The site declares itself dark, so extensions like Dark Reader leave it alone.

## 2.1.1 (2026-05-19)

### Highlights

- **Site**: English moved under `/en/…`, alongside `/es/…` and `/ja/…`, so all three languages are addressed the same way. Landing on nadeshiko.co sends you to the language you last picked, or the one your browser asks for, and every old link still works.
- **Search**: the category tabs show what you can see over what exists, as `12/40`, whenever a filter is holding results back. Narrowing to one show, or hiding media in your settings, now tells you how much of the corpus you are not looking at.

### Fixes

- **Search**: searching a katakana word returns the sentences that contain it instead of the whole database. Eight characters (イ, ク, セ, ヌ, ヒ, ラ, ャ, ュ) came back from the reading analyzer as nothing at all, and nothing was being read as "match everything".
- **Sentence**: expanding a sentence shows the text it added instead of leaving it invisible, and picks the true neighbouring line, so the first and last sentence of an episode expand correctly.

## 2.1.0 (2026-04-21)

### Highlights

- **Site**: Spanish and Japanese moved under `/es/…` and `/ja/…`. The language you are reading in is part of the address, so a link you share arrives in the language you sent it in, and pages can be cached and served from the edge rather than built again for each reader.
- **Site**: the interface is translated where it used to fall back to English. Over four hundred strings now have Spanish and Japanese, across Settings, the account and activity pages, stats, home and search.
- **Sentence**: a sentence link is short now. `/sentence/` takes a twelve-character id instead of a thirty-six-character one, and links you saved with the old id still open.
- **Search**: the show name, episode and timestamp under a result are real links. You can middle-click them into a new tab, copy the show's name as text, and the timestamp opens that sentence on its own page.

### Fixes

- **Site**: opening someone's `/ja` link no longer switches your site language to Japanese for good. Your language is what you chose in the picker, not the last link you happened to follow.
- **Sentence**: a spoiler-tagged translation can be tapped to reveal on a phone. It only uncovered on hover, which a touch screen has no way to do.
- **Sentence**: a spoiler-tagged translation no longer leaks the answer. The word matching your search stayed in its highlight colour and showed straight through the cover.
- **Anki**: a greyed-out Anki entry says why it is greyed out. It reads "Configure Anki in Settings to use this feature" rather than simply refusing to be clicked.
- **Search**: the player's keyboard shortcuts stay quiet while the player is hidden, so space, the arrow keys, R, F and L do not act on something you cannot see.
- **Search**: Escape closes the dialog you have open and stops there, instead of also dismissing the player behind it, and the arrow keys stop walking through results while a dialog is open.
- **Search**: Shift+S jumps to the search box from anywhere on the page. It used to work only once the box had scrolled out of sight.
- **Sentence**: opening the context window starts with the sentence you opened it from selected, so the arrow keys move out from that line rather than from the top of the list.
- **Search**: filtering by show or episode from a sentence page takes you to search results instead of hanging the filter on the sentence's own address, where it did nothing.
- **Site**: the profile menu no longer flashes the signed-out version of itself before catching up with the fact that you are signed in.
- **API**: every path takes the public id you see on the site rather than an internal row number, `/v1/user/me` replaces `/v1/user/quota`, and finding media by name got its own `/v1/search/media`. The character, voice-actor, series and autocomplete endpoints were withdrawn.

## 2.0.7 (2026-04-09)

### Highlights

- **Discord bot**: the bot is out, with `/search`, `/sentence`, `/random`, `/stats`, `/settings`, `/info` and `/health`.
- **Discord bot**: paste a link to a sentence into a channel and the bot answers with the line, its clip attached, and a button that steps through the lines around it. Scenes marked questionable go up as spoilers.
- **Discord bot**: `/search` takes a query, an exact-phrase switch, a category and a show name that autocompletes as you type, and pages through the matches in place.
- **Discord bot**: `/settings` configures the bot per server: which translations sit under each sentence (English, Spanish, both or none) and whether links get expanded at all. Only members who can manage the server see it.
- **Site**: a page you read signed out is cached for an hour and can be served straight from the cache. Every page used to be marked never-cache. Signed in, nothing is cached.

### Fixes

- **Account**: you stay signed in for 30 days instead of 3, and a session you keep using rolls forward, so you are no longer logged out daily.
- **Search**: the English and Spanish toggles survive both signing in and reloading. Two separate things reset them: the login finished before your saved settings had arrived, and an account that had never saved a translation setting overwrote your choice with its empty one.
- **Account**: asking for a magic link from a page other than the front page now signs you in. The link pointed back at the page you asked from and failed there; it now always returns you to the home page, signed in.
- **Site**: a result with no translations showing gets proper padding instead of sitting cramped against the top, and the category tabs no longer leave a stray horizontal scrollbar across a phone screen.
- **Site**: each page carries its own title and description, so a link to search, media, stats or a sentence previews as itself rather than as the generic site card.
- **Media**: covers in the browse grid load as you reach them and reserve their space first, so the grid stops jumping while it fills in.
- **Site**: the sitemap also lists blog posts and the word-coverage pages, and the development site tells search engines to stay out of it.

## 2.0.6 (2026-04-02)

### Highlights

- **Stats**: a stats page, Nadeshiko in Numbers: sentences, unique words, shows, episodes and hours of dialogue, plus how much of the most common Japanese vocabulary has a sentence for it, measured against the Jiten anime frequency list.
- **Stats**: each coverage tier opens the list behind it, so you can see which of the top 5,000 words are covered and which are missing, filtered to covered or uncovered.
- **Stats**: how much of the corpus is translated, for English and Spanish separately, split between official subtitles and DeepL.
- **Account**: Log out is in the profile menu.

### Fixes

- **Account**: signing in with Google or Discord confirms it happened instead of returning you to the page with no sign either way, and a sign-in that failed says so.
- **Site**: the new logo and link-preview card actually show up. The new files had kept the old filenames, so browsers and Discord went on serving the copies they had already cached.

## 2.0.5 (2026-03-31)

### Highlights

- **Site**: a new logo, favicon and link-preview card.
- **API**: search results carry the word breakdown of the Japanese line, reading and dictionary form and part of speech, for every caller. It used to be sent only to accounts enrolled in the tokens lab.
- **Search**: when your word matches in a conjugated form, the rest of the conjugation is marked with a dotted underline right after the match, for everyone rather than only for lab accounts.
- **Settings**: a copy button on a newly created API key.

### Fixes

- **Search**: keyboard shortcuts no longer fire while you are holding a modifier, so copy, paste and the rest of the Ctrl and Cmd combinations reach the browser again.
- **Search**: Yomitan stops at the sentence. The tabs, buttons, filters and badges around a line are marked so the popup dictionary no longer drags interface text into the word it is looking up.
- **Settings**: your developer page shows the real quota, 5,000 rather than the 2,500 it was falling back to, and loads your keys on the first visit instead of the second.
- **Account**: the emails Nadeshiko sends you, magic link, welcome and email change, go out again. Their templates were left out of the deployed server, so building the message failed. They were redesigned at the same time.
- **Site**: on a phone the home page, the search bar and the header get proper side padding instead of running to the edge, the hamburger icon is centred, the menu closes when you navigate, and the API keys table scrolls sideways rather than overflowing the screen.
- **Settings**: the settings tab strip scrolls the tab you are on into view instead of leaving it off the side.

## 2.0.4 (2026-03-22)

### Highlights

- **Site**: nadeshiko.co serves the new site. It had been at new.nadeshiko.co since 2.0.0, with the previous version at old.nadeshiko.co.

### Fixes

- **Anki**: mining reaches Anki on your own machine again. The new site's security policy refused connections to 127.0.0.1, which is where AnkiConnect listens.
- **Sentence**: expanding a sentence loads the image and audio for the lines it adds. The same policy was blocking the CDN they come from.
- **Site**: the sitemap lists every show again, and the API reference is allowed to be indexed rather than swept up in the blanket ban on /api/.

## 2.0.3 (2026-03-21)

### Fixes

- **Sentence**: the context window's scrollbar is dark in Chrome, instead of a bright default strip down the side of the panel.

## 2.0.2 (2026-03-18)

### Highlights

- **Site**: a notice banner for maintenance and incidents, so a planned outage can say so at the top of every page.
- **Activity**: exporting a card to Anki is recorded in your activity history, alongside searches, plays and shares.
- **API**: the reference at /api/v1/docs opens directly instead of inside a frame on the page.

### Fixes

- **Site**: a page loads even when there is no notice to show. The empty response from the announcements endpoint was being read as an announcement, and that took the whole page down with it.
- **Anki**: mining no longer forces the Anki card browser to the front on every export. There is a switch for it in your Anki settings.
- **Anki**: a card fetches only the screenshot and audio the note actually asks for, so a note with no image field stops downloading one.
- **Anki**: the note's info field says "Movie" for a film instead of "Episode 0", and carries a link back to the sentence on Nadeshiko.
- **Anki**: profiles are named when you create them and can be renamed afterwards, and switching between profiles no longer writes the settings you were looking at over the one you switched to.
- **Anki**: when your card exists but is sitting in a different deck, the error says so and names the deck, instead of claiming there is no card to export to.
- **Site**: Japanese text is marked as Japanese line by line rather than the whole page being declared Japanese, so the browser picks Japanese glyph shapes for the sentences and leaves the interface alone.
- **Site**: the menu folds into the hamburger below tablet width instead of cramming the full row into a narrow screen, and the dot on the blog link stops showing once you are reading the blog.
- **API**: the default rate limit for a key became 150 requests a minute, in place of 2,000 across five minutes.

## 2.0.0 (2026-03-17)

### Highlights

- **Site**: Nadeshiko moved off the Orange Pi on a home connection and onto a dedicated server, with images and audio on a CDN. The post that came with it is at [/blog/a-new-home-for-nadeshiko](/blog/a-new-home-for-nadeshiko).
- **Site**: the move is also when the whole 1.5 line reached readers. Collections, reports, hidden media and the activity history were tagged in 1.5 but only reachable at new.nadeshiko.co until this launch; they are listed under the versions that carried them.
- **Site**: a welcome card on your first visit, linking to that post and to the old site.
- **Account**: accounts and API keys were carried across. A key made on the old site keeps working and keeps the name you gave it rather than becoming "Migrated Legacy Key #12".

## 1.5.1 (2026-03-11)

### Highlights

- **Media**: media can carry a TMDB id, so a show can be matched against an external catalogue.

### Fixes

- **Site**: a URL that does not exist shows a real error page instead of the blank screen the app fell through to.
- **Site**: pages arrive with their styles already applied, rather than appearing unstyled for a moment and then snapping into shape.

## 1.5.0 (2026-02-28)

### Highlights

- **Account**: your account is a set of pages under `/user`, with tabs for Settings, Anki, Collections, Activity, Hide Media, Developer and Labs. The old `/settings/…` links redirect there instead of 404ing.
- **Collections**: save a sentence into a named collection from the menu on any result, rename or delete a collection, keep it private or make it public, and open a collection as its own set of results.
- **Activity**: a history of what you searched, played, mined and shared, with a year-long heatmap, a streak count, and the option to delete a single day.
- **Settings**: hide a show from your results, either from the menu on a result or from a search box in settings. A hidden show is left out of the query rather than filtered out of the answer, and its media page says so and offers to show it anyway.
- **Settings**: sensitive results are blurred rather than shown outright, and you choose show, blur or hide per rating, with a preview of how a flagged result will look.
- **Search**: each translation language has three states instead of on and off: shown, spoiler, and hidden. The choice rides along in a cookie, so the first render of the page already respects it instead of showing a translation you had hidden and then removing it.
- **Search**: report a problem on a sentence or a show with a specific reason (wrong translation, timing, audio, rating, duplicate, missing episodes, wrong cover), and track it on a My Reports page. The old form only sent a message into the void.
- **Search**: press `?` for a keyboard shortcuts panel: moving between results, previous and next segment, play, pause, restart, autoplay, immersive mode, add to Anki and open context.
- **Search**: a search has its own URL, `/search/<your query>`, so the search you ran is a link you can bookmark or send to someone.
- **Sentence**: every sentence has a permanent page at `/sentence/<id>`, with `/s/<id>` as the short form that redirects to it.
- **Search**: Japanese is analysed with Sudachi instead of Kuromoji, and a sentence is also matched on its normalized spelling, so a search for 打ち込む finds the line that writes it 打込む.
- **Search**: sentence length stopped overruling how well a sentence matches. Length is a gentle tiebreaker now, and anything from 17 to 37 characters carries no length penalty at all, where before every result was scored into a length tier first.
- **Site**: Media and Blog are in the header, and the blog has its own page.
- **API**: an API key can be renamed after you have created it.

### Fixes

- **Home**: the counters on the home page count the whole library. They used to add up only the shows in the recently-added strip below them, so the number moved with whatever happened to be on screen.
- **Media**: result images are served in a smaller optimized form, so a grid of them is a much lighter page.
- **Site**: a layout built for tablet widths, instead of choosing between the phone one and the desktop one.
- **Search**: the empty-results page points you at immersionkit.com rather than only telling you to try something else.

## 1.2.4 (2026-01-20 – 2026-02-09)

### Highlights

- **Sentence**: an audio player for shadowing and listening, with play, pause, skip, seek, fast forward and rewind, autoplay straight through the results, repeat, and a full-screen immersive mode that shows the line large over its image and scrolls itself as it goes.
- **Search**: the results page is rendered on the server, so a search you open from a link arrives with its sentences already in it.
- **API**: a global rate limiter, the reference rebuilt on the current Scalar, and the missing `MediaInfo` schema in the spec.

### Fixes

- **Search**: a link you share carries a real preview: the show's name as the title, and a description with how many sentences matched and which season and episode they are from.
- **Anki**: your Anki configuration survives a reload again, and picking a note type stops overwriting fields you had already set.
- **Site**: the DMCA, privacy and terms pages were rewritten, and the markdown they are built from renders properly.

## 1.2.3 (2026-01-12)

### Fixes

- **Media**: the media page loads its images as you reach them instead of all at once.

## 1.2.2 (2026-01-11)

### Highlights

- **Search**: sort results oldest or newest first.

### Fixes

- **Search**: the episode filter is hidden for movies and audiobooks, which have no episodes to filter by, and picking a different show clears the season and episode you had set for the previous one.
- **Search**: opening the site on a phone no longer pops the keyboard open, and the workaround that broke scrolling in Firefox on mobile is gone.

## 1.2.1 (2026-01-11)

### Highlights

- **Search**: filter by season and episode.

### Fixes

- **Search**: typing in the filter box no longer lags, because it waits for you to stop before it searches.

## 1.2.0 (2026-01-10)

### Fixes

- **Search**: the top bar says which show you are looking at, and keeps saying it when you switch to a category the show is not in.

## 1.1.4 (2026-01-10)

### Highlights

- **Home**: the cards on the home page link to the show they are from, and a media id on its own is a search you can run.
- **Stats**: statistics come back richer, and can be narrowed to one anime.

## 1.1.3 (2026-01-10)

### Fixes

- **Account**: the login box stops offering the email and password form that was retired back in 1.0.5, so what you see is what actually works.
- **API**: the API key menu closes when you click outside it.

## 1.1.2 (2026-01-10)

### Highlights

- **API**: a dialog for creating fine-grained API keys.

### Fixes

- **Site**: moving between the About, FAQ, terms, privacy and DMCA pages loads the page you clicked. It used to leave the previous page's text on screen.
- **Site**: the Spanish, English and Japanese strings that were missing are filled in.

## 1.1.1 (2025-10-13)

### Highlights

- **Anki**: the Episode Info field carries the timestamp of the line as well as the show, season and episode.

### Fixes

- **Home**: the home page is rendered on the server, so it arrives complete rather than assembling itself in front of you.
- **Sentence**: expand left, right and both moved into the sentence's menu. They were buttons that only appeared when a mouse hovered the line, so on a phone there was no way to reach them.
- **Sentence**: the line under a sentence shows the time it starts in the episode.

## 1.1.0 (2025-08-28)

### Highlights

- **Media**: initial support for audiobooks.
- **Anki**: an Episode Info field you can map to a note, filled in with the show name, season and episode.

### Fixes

- **Search**: one and two word fragments stopped leading the results. Sentences of at least five characters are scored higher when you have not set a minimum length.

## 1.0.7 – 1.0.8 (2025-04-06)

### Highlights

- **Search**: filter by minimum and maximum sentence length.
- **Sentence**: an expanded sentence can have its audio saved, not just the original line.
- **API**: a key you no longer want can be deactivated and deleted, and the list shows the active ones rather than everything you have ever made.

### Fixes

- **Sentence**: the expand buttons are disabled while the sentence is being expanded, so a second click cannot land in the middle of the first.
- **Account**: the settings menu is translated.

## 1.0.6 (2025-03-06)

### Highlights

- **API**: the quota went from 5,000 to 20,000 requests, and search got a health endpoint you can check.

### Fixes

- **Search**: an exact search inside Simultaneous Search returns exact matches.
- **Account**: the profile button fits on a small screen.

## 1.0.5 (2025-03-01 – 2025-03-02)

### Highlights

- **Site**: Japanese translation.
- **Account**: login revamped. Anki mining is no longer behind a login wall, and signing up with an email and password is retired.
- **API**: API keys work again.
- **Media**: the page listing everything in the library was rebuilt.
- **Search**: Simultaneous Search takes 500 words at a time instead of 200.

### Fixes

- **Search**: results that came back broken or half-empty.
- **Sentence**: audio for an expanded sentence is built faster.
- **Search**: Simultaneous Search will not run on an empty box, the sidebar fits small screens, and the filter panel stops overflowing its text.
- **Search**: scrolling to the top, and the Shift+S shortcut, jump straight there instead of animating the whole way.

## 1.0.2 (2024-10-26)

### Highlights

- **Search**: 20 sentences per search instead of 10.

### Fixes

- **Sentence**: audio plays on iOS.
- **Search**: scrolling loads the next sentences in the cases where it used to stop, and the loading indicator is back while it does.
- **Sentence**: an expanded sentence hands Anki an audio file of the right type, instead of one Anki would not play.

## 1.0.0 (2024-09-27)

### Highlights

- **Anki**: mine without the browser extension, and point mining at your own AnkiConnect address.
- **Sentence**: expand a sentence with the one before it, the one after it, or both.
- **Anki**: an expanded sentence mines as a single audio file, rather than two clips played one after the other.

### Fixes

- **Sentence**: audio that played back slowly.

## 0.9.9 (2024-09-09)

### Highlights

- **Anki**: add to a specific note instead of only the last one you made, by searching your collection for the card you want.
- **Anki**: which fields a mined card fills is yours to set in settings, and the note dialog was rebuilt around it.

### Fixes

- **Anki**: the browser extension works with the current site again.
- **Anki**: mining tells you when the key field is not configured, instead of failing with nothing on screen.
- **Search**: batch search sends you to the right place.
- **Site**: messages come up as toasts rather than browser alert boxes you have to dismiss.

## Before 1.0 (2023)

Nadeshiko began as BrigadaSOS-db: sorting, multiple languages, toasts, vocabulary highlighted in a sentence with MeCab and PGroonga, and the permission handling that came with opening it to everyone. Those tags are in the repository if you want them, but there is little in them you would have noticed as a reader.

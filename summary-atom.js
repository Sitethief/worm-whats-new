'use strict'
/***
 This JS is terrible and bullshit, you probably want look away.
 <3 iarna
 ***/
const fs = require('fs')
const readFics = require('./read-fics.js')
const html = require('./html-template-tag')
const approx = require('approximate-number');
const moment = require('moment')
const MiniPass = require('minipass')
const writtenNumber = require('written-number')
const qw = require('qw')

const xoverLinks = require('./substitutions/xover.js')
const ficLinks = require('./substitutions/fics.js')
const charLinks = require('./substitutions/chars.js')
const tagLinks = require('./substitutions/tags.js')
const catLinks = require('./substitutions/cats.js')

module.exports = (pivot, week) => {
  const start = moment.utc({hour:0, minute:0, seconds:0, milliseconds:0})
  if (start.day() < pivot) {
    start.week(start.week()-1)
  }
  start.day(pivot)
  start.week(start.week() + week)

  const end = moment.utc({hour:0, minute:0, seconds:0, milliseconds:0})
  if (end.day() >= pivot) {
    end.add(end.week()+1)
  }
  end.day(pivot)
  end.week(end.week() + week + 1)

  const ourStream = new MiniPass()

  printSummary(start, end, ourStream).catch(err => ourStream.emit('error', err))
  return ourStream
}

module.exports.fromDates = (start, end) => {
  const ourStream = new MiniPass()

  printSummary(start, end, ourStream)
  return ourStream
}

function inRange (date, start, end) {
 return start.isSameOrBefore(date) && end.isAfter(date)
}
function chapterDate (chap) {
  return moment(chap.modified || chap.created).utc()
}

function printSummary (start, end, ourStream) {
  const changes = {
    fic: {
      new: [],
      revived: [],
      updated: [],
      completed: [],
      oneshot: [],
    },
    quest: {
      new: [],
      revived: [],
      updated: [],
      completed: [],
      oneshot: [],
    },
  }
  const isQuest = fic => fic.tags.some(t => t === 'Quest')
  const bucket = fic => changes[isQuest(fic) ? 'quest' : 'fic']

  const xml  = `https://shared.by.re-becca.org/misc/worm/this-week.xml`
  const html = `https://shared.by.re-becca.org/misc/worm/this-week.html`
  ourStream.write('<?xml version="1.0" encoding="UTF-8"?>\n')
  ourStream.write('<feed xml:lang="en-US" xmlns="http://www.w3.org/2005/Atom">\n')
  ourStream.write(`  <id>${xml}</id>\n`)
  ourStream.write(`  <link rel="alternate" type="text/html" href="${html}"/>\n`)
  ourStream.write(`  <link rel="self" type="application/atom+xml" href="${xml}"/>\n`)
  ourStream.write(`  <title>This week's Worm fanfic updates</title>\n`)
  ourStream.write(`  <updated>${new Date().toISOString()}</updated>\n`)

  return readFics(`${__dirname}/Fanfic.json`)
    .filter(fic => fic.fandom === 'Worm')
    .filter(fic => inRange(fic.meta ? fic.meta.modified : fic.updated, start, end))
    .filter(fic => fic.tags.length === 0 || !fic.tags.some(t => t === 'noindex'))
    .sort((a, b) => moment(a.updated).isAfter(b.updated) ? 1 : moment(a.updated).isBefore(b.updated) ? -1 : 0)
    .forEach(fic => {
      fic.newChapters = fic.meta ? fic.meta.chapters.filter(chap => inRange(chapterDate(chap), start, end)) : []
      if (!fic.newChapters.length) {
        console.error('No new chapters, skipping:', fic.title)
        return
      }
      fic.oldChapters = fic.meta ? fic.meta.chapters.filter(chap => start.isAfter(chapterDate(chap))) : []
      const prevChapter = fic.oldChapters.length && fic.oldChapters[fic.oldChapters.length - 1]
      const newChapter = fic.newChapters.length && chapterDate(fic.newChapters[0]).subtract(3, 'month')
      if (fic.tags.some(t => t === 'Snippets')) {
        fic.title = fic.title.replace(/^[^:]+: /i, '')
      }
      if (fic.status === 'complete' || fic.status === 'one-shot') {
        // nothing
      } else if (start.isSameOrBefore(fic.pubdate)) {
        fic.status = 'new'
      } else if (prevChapter && chapterDate(prevChapter).isBefore(newChapter)) {
        fic.status = 'revived'
      } else {
        fic.status = 'updated'
      }
      printFic(ourStream, fic)
    }).then(() => {
      ourStream.write('</feed>\n')
      ourStream.end()
    })
}

function printFic (ourStream, fic) {
  const chapters = fic.meta.chapters.length
  const newChapters = fic.newChapters.length
  const firstUpdate = fic.newChapters[0] || fic.meta.chapters[fic.meta.chapters.length - 1]
  const newWords = fic.newChapters.map(c => c.words).reduce((a, b) => a + b, 0)
  const authorurl = fic.authorurl || fic.meta.authorUrl
  let summary = []
  if (fic.series && fic.series !== fic.title) {
    summary.push(html`<b>Follows:</b> ${tagify(fic.series, ficLinks)})`)
  }
  summary.push(html`<b>Status:</b> ${fic.status}`)
  summary.push(html`<b>Added:</b> ${cstr(newChapters)}, ${approx(newWords)} words`)
  summary.push(html`<b>Total length:</b> <a href="${fic.identifiers.replace(/^ur[li]:/,'\n')}">${cstr(chapters)}, ${approx(fic.words)} words</a>`)
  
  const genre = fic.tags.filter(t => /^genre:/.test(t)).map(t => t.slice(6))
  const xover = fic.tags.filter(t => /^xover:/.test(t)).map(t => t.slice(6))
  const fusion = fic.tags.filter(t => /^fusion:/.test(t)).map(t => t.slice(7))
  const meta = fic.tags.filter(t => /^meta:/.test(t)).map(t => t.slice(5))
  const language = fic.tags.filter(t => /^language:/.test(t)).map(t => t.slice(9))
  let rating = fic.tags.filter(t => /^rating:/.test(t)).map(t => t.slice(7))
  rating = rating.concat(fic.tags.filter(t => /^rated:/.test(t)).map(t => t.slice(6)))
  const category = fic.tags.filter(t => /^category:/.test(t)).map(t => t.slice(9))
  const characters = fic.tags.filter(t => /^character:/.test(t))
       .map(t => t.slice(10).replace(/ \(Worm\)/, '').replace(/ - Character/i, ''))
       .map(t => tagify(t, tagLinks))
  const tags = fic.tags.filter(t => !/^(?:genre|xover|fusion|meta|rating|rated|character|category|language):|^(?:NSFW|Quest|Snippets)$/i.test(t))
    .map(t => t.replace(/^freeform:/, ''))
    .map(t => /altpower:/.test(t) ? tagify(t, Object.assign({}, charLinks, xoverLinks))  : t)
  summary.push(html`<b>Updated on:</b> ${chapterDate(fic.newChapters[fic.newChapters.length -1]).format('ddd [at] h a')} UTC`)
  if (genre.length !== 0) summary.push(html`<b>Genre:</b> ${genre.join(', ')}\n`)
  if (category.length !== 0) summary.push(`<b>Category:</b> ${strify(category, catLinks)}\n`)
  if (xover.length !== 0) summary.push(`<b>Crossover:</b> ${strify(xover, xoverLinks)}\n`)
  if (fusion.length !== 0) summary.push(`<b>Fusion:</b> ${strify(fusion, xoverLinks)}\n`)
  if (meta.length !== 0) summary.push(`<b>Meta-fanfiction of:</b> ${strify(meta, ficLinks)}\n`)
  if (tags.length !== 0) summary.push(`<b>Tags:</b> ${strify(tags, tagLinks)}\n`)
  if (fic.pov != '' && fic.pov != null) summary.push(`<b>POV:</b> ${strify(fic.pov.split(/, /), charLinks)}\n`)
  if (fic.otn != '' && fic.otn != null) summary.push(`<b>Romantic pairing:</b> ${strify(fic.otn.split(', '), charLinks)}\n`)
  if (fic.ftn != '' && fic.ftn != null) summary.push(`<b>Friendship pairing:</b> ${strify(fic.ftn.split(', '), charLinks)}\n`)
  if (characters.length) summary.push(`<b>Characters:</b> ${strify(characters, charLinks)}\n`)
  if (rating.length) summary.push(html`<b>Rating:</b> ${rating}\n`)
  if (fic.rec != '' && fic.rec != null) summary.push(`<b>Summary:</b><br>${fic.rec}\n`)

  ourStream.write(html`  <entry>
    <id>${fic.identifiers.replace(/^ur[li]:/,'')}#${fic.meta.chapters.length}</id>
    <published>${moment(fic.meta.created || fic.pubate).toISOString()}</published>
    <updated>${moment(fic.meta.modified || fic.updated).toISOString()}</updated>
    <link href="${firstUpdate.link}"/>
    <title>${fic.title} - ${firstUpdate.name}</title>
    <summary type="html">${summary.join('<br>\n')}</summary>
    <author>
      <name>${fic.authors}</name>
      <uri>${authorurl}</uri>
    </author>
  </entry>\n`)
}

function cstr (chapters) {
  if (chapters === 1) {
    return `${chapters} chapter`
  } else {
    return `${chapters} chapters`
  }
}

function strify (things, links) {
  return linkUp(things, links).join(', ')
}
function tagify (thing, links) {
  for (let link of Object.keys(links)) {
    thing = thing.replace(new RegExp('\\b' + link + '\\b'), `<a href="${links[link]}">${link}</a>`)
  }
  return thing
}
function linkUp (things, links) {
  return things.map(thing => tagify(thing, links))
}

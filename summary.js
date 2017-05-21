'use strict'
const fs = require('fs')
const readFics = require('./read-fics.js')
const html = require('html-template-tag')
const approx = require('approximate-number');
const moment = require('moment')
const MiniPass = require('minipass')
const qw = require('qw')

const xoverLinks = require('./substitutions/xover.js')
const ficLinks = require('./substitutions/fics.js')
const charLinks = require('./substitutions/chars.js')
const tagLinks = require('./substitutions/tags.js')
const catLinks = require('./substitutions/cats.js')

module.exports = (pivot, week) => {
  const start = moment.utc({hour:0, minute:0, seconds:0, milliseconds:0}).day((pivot - 7) + week)
  const end   = moment.utc({hour:0, minute:0, seconds:0, milliseconds:0}).day(pivot + week)

  const ourStream = new MiniPass()

  printSummary(start, end, ourStream)
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
  return moment(chap.modified || chap.created)
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

  readFics(`${__dirname}/Fanfic.json`)
    .filter(fic => fic.fandom === 'Worm')
    .filter(fic => inRange(fic.updated, start, end))
    .filter(fic => fic.tags.length === 0 || !fic.tags.some(t => t === 'noindex'))
    .forEach(fic => {
      fic.newChapters = fic.meta ? fic.meta.chapters.filter(chap => inRange(chapterDate(chap), start, end)) : []
      if (!fic.newChapters.length) {
        console.error('No new chapters, skipping:', fic.title)
        return
      }
      fic.oldChapters = fic.meta ? fic.meta.chapters.filter(chap => start.isAfter(chapterDate(chap))) : []
      const prevChapter = fic.oldChapters.length && fic.oldChapters[fic.oldChapters.length - 1]
      const newChapter = fic.newChapters.length && chapterDate(fic.newChapters[0]).subtract(3, 'month')
      if (fic.status === 'complete') {
        bucket(fic).completed.push(fic)
      } else if (fic.status === 'one-shot') {
        fic.title = fic.title.replace(/^[^:]+snip[^:]+: /i, '')
        bucket(fic).oneshot.push(fic)
      } else if (start.isSameOrBefore(fic.pubdate)) {
        bucket(fic).new.push(fic)
      } else if (prevChapter && chapterDate(prevChapter).isBefore(newChapter)) {
        bucket(fic).revived.push(fic)
      } else {
        bucket(fic).updated.push(fic)
      }
    }).finally(() => {
      const week = `${start.format('YYYY-MMM-DD')} to ${end.subtract(1, 'days').format('MMM-DD')}`
      ourStream.write('<!DOCTYPE html>\n')
      ourStream.write('<html>\n')
      ourStream.write('<head>\n')
      ourStream.write(html`<head><title>Worm fanfic in the week of ${week}</title>\n`)
      ourStream.write(html`<style>
  body {
    margin-left: auto;
    margin-right: auto;
    margin-top: 3em;
    padding-left: 1em;
    padding-right: 1em;
    max-width: 800px;
  }
  .week {
    white-space: nowrap;
  }
  </style>\n`)
      ourStream.write('</head>\n')
      ourStream.write('<body>\n')
      ourStream.write(`<h2>Worm fanfic in the week of <span class="week">${week}</span></h2>\n`)
      for (let type of qw`fic quest`) {
        const updates = []
        if (changes[type].new.length) {
          updates.push(html`new ${type}s: ${changes[type].new.length}`)
        }
        if (changes[type].completed.length) {
          updates.push(html`completed ${type}s: ${changes[type].completed.length}`)
        }
        if (changes[type].oneshot.length) {
          updates.push(html`new one-shot ${type}s: ${changes[type].oneshot.length}`)
        }
        const updated = changes[type].updated.length + changes[type].revived.length 
        if (updated) {
          updates.push(html`updated ${type}s: ${updated}`)
        }
        ourStream.write(`${ucfirst(updates.join(', '))}<br>\n`)
      }
      for (let type of qw`fic quest`) {
        if (!changes[type].new.length) continue
        ourStream.write(`<h2><u>New ${ucfirst(type)}s</u></h2>\n`)
        changes[type].new.sort((a, b) => a.title.localeCompare(b.title)).forEach(fic => printFic(ourStream, fic))
        ourStream.write(`<br><br>\n`)
        console.error(`New ${type}:`, changes[type].new.length)
      }
      for (let type of qw`fic quest`) {
        if (!changes[type].completed.length) continue
        ourStream.write(`<h2><u>Completed ${ucfirst(type)}s</u></h2>\n`)
        changes[type].completed.sort((a, b) => a.title.localeCompare(b.title)).forEach(fic => printFic(ourStream, fic))
        ourStream.write(`<br><br>\n`)
        console.error(`Completed ${type}:`, changes[type].completed.length)
      }
      for (let type of qw`fic quest`) {
        if (!changes[type].oneshot.length) continue
        ourStream.write(`<h2><u>One-shot ${ucfirst(type)}s</u></h2>\n`)
        changes[type].oneshot.sort((a, b) => a.title.localeCompare(b.title)).forEach(fic => printFic(ourStream, fic))
        ourStream.write(`<br><br>\n`)
        console.error(`One-shot ${type}:`, changes[type].oneshot.length)
      }
      for (let type of qw`fic quest`) {
        if (!changes[type].revived.length) continue
        ourStream.write(`<h2><u>Revived ${ucfirst(type)}s</u></h2>\n`)
        ourStream.write(`<p style="margin-top: -1em;"><em>(last update was ≥ 3 months ago)</em></p>\n`)
        changes[type].revived.sort((a, b) => a.title.localeCompare(b.title)).forEach(fic => printFic(ourStream, fic))
        ourStream.write(`<br><br>\n`)
        console.error(`Revived ${type}:`, changes[type].revived.length)
      }
      for (let type of qw`fic quest`) {
        if (!changes[type].updated.length) continue
        ourStream.write(`<h2><u>Updated ${ucfirst(type)}s</u></h2>\n`)
        changes[type].updated.sort((a, b) => a.title.localeCompare(b.title)).forEach(fic => printFic(ourStream, fic))
        ourStream.write(`<br><br>\n`)
        console.error(`Updated ${type}:`, changes[type].updated.length)
      }
      ourStream.write('</body></html>\n')
      ourStream.end()
    })
}

function printFic (ourStream, fic) {
  const chapters = fic.meta.chapters.length
  const newChapters = fic.newChapters.length
  const newWords = fic.newChapters.map(c => c.words).reduce((a, b) => a + b, 0)

  const author = fic.authorurl ? html`<a href="${fic.authorurl}">${fic.authors.replace(/_and_/g,'and')}</a>` : html`${fic.authors}`
  ourStream.write('<hr><article>\n')
  const follows = (fic.series && fic.series !== fic.title) ? ` (follows ${tagify(fic.series, ficLinks)})` : ''
  ourStream.write(html`<b><a href="${fic.identifiers.replace(/^ur[li]:/,'\n')}">${fic.title}</a>${[follows]} (${approx(newWords)} words) `)
  ourStream.write(`by ${author}</b>\n`)
  
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
  const tags = fic.tags.filter(t => !/^(?:genre|xover|fusion|meta|rating|rated|character|category|language):|^(?:NSFW|Quest)$/i.test(t))
    .map(t => t.replace(/^freeform:/, ''))
    .map(t => /altpower:/.test(t) ? tagify(tagify(tagify(t, charLinks), tagLinks), xoverLinks) : t)
  ourStream.write(html`<br><b>Total length:</b> ${cstr(chapters)}, ${approx(fic.words)} words`)
  ourStream.write(html`<br><b>Updated on:</b> ${chapterDate(fic.newChapters[fic.newChapters.length -1]).format('ddd [at] h a')} UTC`)
  if (genre.length !== 0) ourStream.write(html`<br><b>Genre:</b> ${genre.join(', ')}\n`)
  if (category.length !== 0) ourStream.write(`<br><b>Category:</b> ${strify(category, catLinks)}\n`)
  if (xover.length !== 0) ourStream.write(`<br><b>Crossover:</b> ${strify(xover, xoverLinks)}\n`)
  if (fusion.length !== 0) ourStream.write(`<br><b>Fusion:</b> ${strify(fusion, xoverLinks)}\n`)
  if (meta.length !== 0) ourStream.write(`<br><b>Meta-fanfiction of:</b> ${strify(meta, ficLinks)}\n`)
  if (tags.length !== 0) ourStream.write(`<br><b>Tags:</b> ${strify(tags, tagLinks)}\n`)
  if (fic.pov != '' && fic.pov != null) ourStream.write(`<br><b>POV:</b> ${strify(fic.pov.split(/, /), charLinks)}\n`)
  if (fic.otn != '' && fic.otn != null) ourStream.write(`<br><b>Romantic pairing:</b> ${strify(fic.otn.split(', '), charLinks)}\n`)
  if (fic.ftn != '' && fic.ftn != null) ourStream.write(`<br><b>Friendship pairing:</b> ${strify(fic.ftn.split(', '), charLinks)}\n`)
  if (characters.length) ourStream.write(`<br><b>Characters:</b> ${strify(characters, charLinks)}\n`)
  if (rating.length) ourStream.write(html`<br><b>Rating:</b> ${rating}\n`)
  if (fic.rec != '' && fic.rec != null) ourStream.write(`<br><b>Summary:</b><br>${fic.rec}\n`)
  ourStream.write('</article>\n')
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
    thing = thing.replace(new RegExp(link), `<a href="${links[link]}">${link}</a>`)
  }
  return thing
}
function linkUp (things, links) {
  return things.map(thing => tagify(thing, links)) //links[thing] ? html`<a href="${links[thing]}">${thing}</a>` : `${thing}`)
}

function ucfirst (str) {
  return str.slice(0,1).toUpperCase() + str.slice(1)
}

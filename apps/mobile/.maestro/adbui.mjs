// Drive the app on a device where Maestro's driver apps cannot be installed (Xiaomi HyperOS with
// enhanced protection blocks every sideload). Uses only `adb shell uiautomator dump` and `input`.
//   node adbui.mjs <serial> <command> [arg] ...      commands run left to right:
//   launch            clear the app's data and start it
//   wait:<id|"text">  wait up to 60 s for a test id or a visible text
//   tap:<id|"text">   scroll down until it is on screen, then tap its centre
//   type:<text>       type into the focused field (ASCII)
//   shot:<file.png>   save a screenshot
//   has:<id|"text">   exit 1 if it is not on screen
//   practice          answer the open practice session until its summary shows
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [serial, ...commands] = process.argv.slice(2);
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { maxBuffer: 1 << 26 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = 'vn.vionx.app';

function nodes() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/ui.xml').toString();
  return [...xml.matchAll(/<node [^>]*>/g)].map((m) => {
    const attr = (k) => m[0].match(new RegExp(`${k}="([^"]*)"`))?.[1] ?? '';
    const b = attr('bounds').match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0];
    return { id: attr('resource-id'), text: attr('text'), desc: attr('content-desc'), b };
  });
}
const size = () =>
  adb('shell', 'wm', 'size')
    .toString()
    .match(/(\d+)x(\d+)\s*$/)
    .slice(1)
    .map(Number);
function find(target) {
  const text = target.startsWith('"') ? target.slice(1, -1) : null;
  const [w, h] = screen;
  return nodes().find((n) => {
    const hit = text === null ? n.id === target : n.text.includes(text) || n.desc.includes(text);
    const [x1, y1, x2, y2] = n.b;
    return hit && x2 > x1 && y2 > y1 && y1 >= 0 && y2 <= h && x2 <= w;
  });
}
async function waitFor(target, ms = 60000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(700)) {
    const n = find(target);
    if (n) return n;
  }
  throw new Error(`not on screen after ${ms} ms: ${target}`);
}
async function scrollTo(target) {
  const [w, h] = screen;
  for (let i = 0; i < 25; i++) {
    const n = find(target);
    if (n) return n;
    adb('shell', 'input', 'swipe', `${w / 2}`, `${h * 0.7}`, `${w / 2}`, `${h * 0.35}`, '400');
    await sleep(600);
  }
  throw new Error(`not found by scrolling: ${target}`);
}

/** Tap it if it shows up within `ms` (scrolling once if needed); false when it does not. */
async function tryTap(target, ms = 0) {
  const [w, h] = screen;
  for (const end = Date.now() + ms; ; await sleep(700)) {
    let n = find(target);
    if (!n && Date.now() >= end) {
      adb('shell', 'input', 'swipe', `${w / 2}`, `${h * 0.7}`, `${w / 2}`, `${h * 0.35}`, '400');
      await sleep(600);
      n = find(target);
    }
    if (n) {
      adb('shell', 'input', 'tap', `${(n.b[0] + n.b[2]) / 2}`, `${(n.b[1] + n.b[3]) / 2}`);
      await sleep(500);
      return true;
    }
    if (Date.now() >= end) return false;
  }
}
/** Tap it only if it is on screen right now. */
async function tapIfPresent(target) {
  const n = find(target);
  if (!n) return false;
  adb('shell', 'input', 'tap', `${(n.b[0] + n.b[2]) / 2}`, `${(n.b[1] + n.b[3]) / 2}`);
  await sleep(400);
  return true;
}
/**
 * Answer a practice session to its summary. Every option on screen is tapped in turn: that picks
 * one for a choice item and fills every slot of an ordering item. Answers need not be right.
 */
async function practice() {
  for (let i = 0; i < 20; i++) {
    if (find('practice-summary') || find('summary-xp')) return;
    for (const answer of ['option-a', 'option-b', 'option-c', 'option-d', 'option-true', 'key-5'])
      await tapIfPresent(answer);
    if (await tapIfPresent('blank-0')) {
      adb('shell', 'input', 'text', 'x');
      adb('shell', 'input', 'keyevent', '111'); // ESCAPE closes the keyboard, never navigates back
      await sleep(500);
    }
    const submitted = await tryTap('practice-submit');
    const continued = await tryTap('practice-continue', 15000);
    if (!submitted && !continued) await tryTap('practice-finish');
  }
  throw new Error('practice session did not reach its summary in 20 rounds');
}

let screen = size();
for (const c of commands) {
  const [cmd, ...rest] = c.split(':');
  const arg = rest.join(':');
  if (cmd === 'launch') {
    adb('shell', 'pm', 'clear', APP);
    adb('shell', 'monkey', '-p', APP, '-c', 'android.intent.category.LAUNCHER', '1');
    await sleep(2500);
    screen = size();
  } else if (cmd === 'wait') await waitFor(arg);
  else if (cmd === 'tap') {
    const n = await scrollTo(arg);
    adb('shell', 'input', 'tap', `${(n.b[0] + n.b[2]) / 2}`, `${(n.b[1] + n.b[3]) / 2}`);
    await sleep(500);
  } else if (cmd === 'type') adb('shell', 'input', 'text', arg);
  else if (cmd === 'shot') writeFileSync(arg, adb('exec-out', 'screencap', '-p'));
  else if (cmd === 'practice') await practice();
  else if (cmd === 'has') {
    if (!find(arg)) throw new Error(`not on screen: ${arg}`);
  } else throw new Error(`unknown command: ${c}`);
  console.log('ok', c);
}

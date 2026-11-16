// Read-aloud on the device (expo-speech). Speech never leaves the phone (CONTRACT §5).
import * as Speech from 'expo-speech';
import { speechLocale } from './practice.ts';

/** Stops whatever is being read and reads `text` in the item's language. */
export function speak(text: string, lang: 'vi' | 'en'): void {
  if (!text.trim()) return;
  void Speech.stop();
  Speech.speak(text, { language: speechLocale(lang), rate: 0.9 });
}

export function stopSpeaking(): void {
  void Speech.stop();
}

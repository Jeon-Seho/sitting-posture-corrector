let context: AudioContext | null = null
export async function enableSound() {
  context ??= new AudioContext()
  await context.resume()
}
export function playCorrection() {
  if (!context || context.state !== 'running') return false
  const tone = context.createOscillator(),
    gain = context.createGain()
  tone.frequency.value = 660
  gain.gain.setValueAtTime(0.08, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22)
  tone.connect(gain)
  gain.connect(context.destination)
  tone.start()
  tone.stop(context.currentTime + 0.23)
  return true
}

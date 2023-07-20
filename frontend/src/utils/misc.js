export function normalizeSentence(string) {
  string = string.trim()
  if (string.endsWith(',')) {
    string = string.slice(0, -1)
  }
  return string.charAt(0).toUpperCase() + string.slice(1)
}

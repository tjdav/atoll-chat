/**
 * Password strength evaluation helper using dynamic import of zxcvbn.
 *
 * @param {string} password - The password string to evaluate.
 * @param {number} [minLength=8] - Minimum required length for default message.
 * @returns {Promise<{ score: number, width: string, colorClass: string, text: string }>}
 */
export async function evaluatePasswordStrength (password, minLength = 8) {
  if (!password) {
    return {
      score: 0,
      width: '0%',
      colorClass: 'progress-bar',
      text: `Minimum ${minLength} characters.`
    }
  }

  try {
    const { default: zxcvbn } = await import('zxcvbn')
    const result = zxcvbn(password)
    const score = result.score
    const colors = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-info', 'bg-success']
    const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong']

    return {
      score,
      width: `${(score + 1) * 20}%`,
      colorClass: `progress-bar ${colors[score]}`,
      text: `Strength: ${labels[score]}. ${result.feedback.warning || ''}`.trim()
    }
  } catch (err) {
    console.error('[passwordUtils] zxcvbn error:', err)
    return {
      score: 0,
      width: '0%',
      colorClass: 'progress-bar',
      text: `Minimum ${minLength} characters.`
    }
  }
}

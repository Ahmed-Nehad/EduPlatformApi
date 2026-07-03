import env, { isProd } from '../../env.ts'
import { Resend } from 'resend';

const resend = new Resend(env.RESEND_API_KEY);

// resend.emails.send({
//   from: 'onboarding@resend.dev',
//   to: 'nmkao333@gmail.com',
//   subject: 'Hello World',
//   html: '<p>Congrats on sending your <strong>first email</strong>!</p>'
// });

/**
 * Sends a password-reset email to a student.
 *
 * This is a thin abstraction so the auth controller stays decoupled from the
 * transport. In development/test it simply logs the link; in production it
 * would integrate with an SMTP/SES provider.
 */
export const sendPasswordResetEmail = async (
  to: string,
  resetUrl: string
): Promise<void> => {
  if (isProd()) {
    resend.emails.send({
      from: 'onboarding@resend.dev',
      to,
      template: {
        id: '63ccb1a0-8daf-4b2e-b013-bdc949a4a551',
        variables: {
          name: 'user',
          verification_url: resetUrl
        }
      }
    })
    console.info(`[email] password-reset link for ${to}: ${resetUrl}`)
    return
  }

  console.info(`[email][dev] password-reset link for ${to}:`)
  console.info(`    ${resetUrl}`)
}

/**
 * Sends an email-verification email to a student.
 *
 * Issued at registration (and on resend). The link points the client at the
 * verify endpoint with the opaque token in the query string.
 */
export const sendEmailVerificationEmail = async (
  to: string,
  verifyUrl: string
): Promise<void> => {
  if (isProd()) {
    resend.emails.send({
      from: 'onboarding@resend.dev',
      to,
      template: {
        id: '63ccb1a0-8daf-4b2e-b013-bdc949a4a551',
        variables: {
          name: 'user',
          verification_url: verifyUrl
        }
      }
    })
    console.info(`[email] verification link for ${to}: ${verifyUrl}`)
    return
  }

  console.info(`[email][dev] verification link for ${to}:`)
  console.info(`    ${verifyUrl}`)
}

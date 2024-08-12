import nodemailer from "nodemailer";

export const sendConfirmationEmail = async (
  username: string,
  email: string,
  token: string
) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: process.env.EMAIL_USER_NODEMAILER,
        pass: process.env.PASSWORD_USER_NODEMAILER, 
      },
    });

    // Contenido del correo
    const mailOptions = {
      from: process.env.EMAIL_USER, 
      to: email,
      subject: "Verificación de cuenta - Nadeshiko",
      html: `<h2>Hola, ${username}!</h2>
             <p>Gracias por registrarte en nuestra plataforma. Por favor, verifica tu cuenta haciendo clic en el enlace a continuación:</p>
             <a href="${process.env.URI_ALLOWED_NODEMAILER}/auth/verify-email?token=${token}">Verificar mi cuenta</a>`,
    };

    await transporter.sendMail(mailOptions);
    console.log("Email de verificación enviado");
  } catch (error) {
    console.error("Error enviando el email de verificación: ", error);
    throw new Error("Error enviando el email de verificación.");
  }
};

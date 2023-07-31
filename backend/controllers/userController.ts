var jwt = require("jsonwebtoken");
import { Authorized, BadRequest, Conflict, NotFound } from "../utils/error";
import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";

import { User } from "../models/user/user";
import { UserRole } from "../models/user/userRole";
import { Role } from "../models/user/role";
import { createToken, maxAge } from "../middleware/createTokenJWT";

const bcrypt = require('bcrypt');

export const signUp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // read from body
    const { username, email, password } = req.body;

    // check if user already exists
    const oldUser = await User.findOne({
      where: { email: email },
    });

    if (oldUser) {
      throw new Conflict("This email has been used. Please try another email.");
    } else {
      // encrypt the password
      const salt: string = await bcrypt.genSalt(10);
      const encryptedPassword: string = await bcrypt.hash(password.toString(), salt);
      // Generate random email verification token
      const jwtSecretKey: string = process.env.SECRET_KEY_JWT
        ? process.env.SECRET_KEY_JWT
        : "";
      const randomTokenEmail: string = jwt.sign({ email: email }, jwtSecretKey);

      // 1: Normal user
      const roles = [1];

      const userRoles = roles.map((roleId) => ({ id_role: roleId }));

      const user = await User.create(
        {
          username: username,
          email: email.toLowerCase(),
          password: encryptedPassword,
          email_token: randomTokenEmail,
          is_verified: false,
          is_active: true,
          user_roles: userRoles,
        },
        { include: UserRole }
      );

      // Send verification email to user
      // await sendConfirmationEmail(name, email.toLowerCase(), randomTokenEmail);
      await user.save();

      // Response
      return res.status(StatusCodes.CREATED).json({
        message: `Se ha creado el usuario: '${req.body.username}' de forma exitosa.`,
        user: user,
      });
    }
  } catch (error) {
    return next(error);
  }
};

export const logIn = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check if user already exists
    const user = await User.findOne({
      where: { email: req.body.email },
      include: UserRole,
    });

    console.log(user);

    if (!user) throw new NotFound("This email has not been found.");
    if (!user.is_active) throw new NotFound("This user is not active.");

    // Compare the passwords
    const password: boolean = await bcrypt.compare(
      req.body.password,
      user.password
    );
    if (!password)
      throw new BadRequest("Wrong email or password. Please try again.");

    if (user.is_verified === false)
      throw new Authorized(
        "The email has not been verified. Please check your email again."
      );

    // Create Token with role permissions
    const user_role = await UserRole.findAll({
      where: { id_user: user.id },
      include: [
        {
          model: Role,
          required: true,
        },
      ],
    });

    const list_roles = user_role.map((user_role) => user_role.id_role);

    const token = createToken(user.id, list_roles);
    res.cookie("access_token", token, {
      httpOnly: true,
      secure: true,
      maxAge: maxAge * 1000,
      sameSite: "none",
    });

    const data_user = {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: user?.UserRoles,
    };

    return res.status(StatusCodes.OK).json({
      message: `Succesful login, ${user.username}`,
      user: data_user,
      token: token,
    });
  } catch (error) {
    return next(error);
  }
};

var jwt = require("jsonwebtoken");
import { Authorized, BadRequest, Conflict, NotFound } from "../utils/error";
import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";

import { User } from "../models/user/user";
import { UserRole } from "../models/user/userRole";
import { Role } from "../models/user/role";
import { UserAuth } from "../models/user/userAuth"
import { createToken, maxAgeJWT } from "../middleware/authentication";
import { Report, ReportStatus, ReportType } from "../models/miscellaneous/report"

const { OAuth2Client } = require("google-auth-library");
const bcrypt = require("bcrypt");

const client = new OAuth2Client({
  clientId: process.env.ID_OAUTH_GOOGLE,
  clientSecret: process.env.SECRET_OAUTH_GOOGLE,
  redirectUri: process.env.URI_ALLOWED_GOOGLE
});

export const logout = (_req: Request, res: Response, _next: NextFunction) => {
  return res.clearCookie("access_token").status(StatusCodes.OK).json({
    status: res.status,
    message: "Logout successfully.",
  });
};

declare module "express" {
  export interface Request {
    jwt: any;
  }
}

export const getUserInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = await User.findOne({
      where: { id: req.jwt.user_id },
    });

    if (!user) throw new NotFound("This user has not been found.");

    const info_user = {
      username: user.username,
      email: user.email,
    };

    return res.status(StatusCodes.OK).json({
      status: res.status,
      info_user,
    });
  } catch (error) {
    return next(error);
  }
};


export const sendReportSegment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {

    const segment = req.body.segment;
    const report_type = req.body.report_type;

    const user = await User.findOne({
      where: { id: req.jwt.user_id },
    });

    if (!user) throw new NotFound("This user has not been found.");

    const reportTypeValue = Number(report_type);
    if (!(reportTypeValue in ReportType)) {
      throw new Error("Invalid report_type value");
    }

    const report = await Report.create(
      {
        segment_id: segment.segment_id,
        segment_uuid: segment.segment_uuid,
        report_type: reportTypeValue,
        user_id: user.id,
        status: ReportStatus.REPORTED
      },
    );

    await report.save();

    return res.status(StatusCodes.OK).json({
      status: res.status
    });
  } catch (error) {
    return next(error);
  }
};


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
      const encryptedPassword: string = await bcrypt.hash(
        password.toString(),
        salt
      );
      // Generate random email verification token
      const jwtSecretKey: string = process.env.SECRET_KEY_JWT
        ? process.env.SECRET_KEY_JWT
        : "";
      const randomTokenEmail: string = jwt.sign({ email: email }, jwtSecretKey);

      // 3: Normal user
      const roles = [3];

      const userRoles = roles.map((roleId) => ({ id_role: roleId }));

      const user = await User.create(
        {
          username: username,
          email: email.toLowerCase(),
          password: encryptedPassword,
          email_token: randomTokenEmail,
          is_verified: false,
          is_active: true,
          UserRoles: userRoles
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

    if (!user) throw new NotFound("This email has not been found.");
    if (!user.is_active) throw new NotFound("This user is not active.");

    // Compare the passwords
    const password: boolean = await bcrypt.compare(
      req.body.password.toString(),
      user.password
    );
    if (!password)
      throw new BadRequest("Wrong email or password. Please try again.");

    if (user.is_verified === false)
      throw new Authorized(
        "The email has not been verified. Please check your email again."
      );

    // Create Token with role
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
      maxAge: maxAgeJWT * 1000,
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

export const loginGoogle = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    let userInfo = await verifyCodeOAuth(req.body.code);

    let user = await User.findOne({
      include: [{
        model: UserAuth, 
        where: { providerUserId: userInfo.sub, provider: 'google' }
      },{
        model: UserRole
      }
    ]
    },);

    if (!user) {
      // Definition of roles for a normal user
      // 3: Normal user
      const roles = [3];
      const userRoles = roles.map((roleId) => ({ id_role: roleId }));

      // Create an user
      user = await User.create({
        username: userInfo.name,
        email: userInfo.email,
        is_verified: true,
        is_active: true,
        UserRoles: userRoles,
      }, { include: UserRole });

      // Create related data from oAUTH
      await UserAuth.create({
        userId: user.id,
        provider: 'google',
        providerUserId: userInfo.sub
      });

    }

    // Create Token JWT with role
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
      maxAge: maxAgeJWT * 1000,
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
    console.log(error)
    return next(error);
  }
};

async function verifyCodeOAuth(code: any) {
  let { tokens } = await client.getToken(code);
  client.setCredentials({ access_token: tokens.access_token });
  const userinfo = await client.request({
    url: "https://www.googleapis.com/oauth2/v3/userinfo",
  });
  return userinfo.data;
}
function hashApiKey(api_key: string): any {
  throw new Error("Function not implemented.");
}


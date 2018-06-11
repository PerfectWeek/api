//
// Created by benard_g on 2018/06/08
//

import {ApiException} from "./apiException";

export function checkEnvVariable(name: string): void {
    if (!process.env[name])
        throw new ApiException(403, "You must set the environment variable \""
            + name
            + "\" to a valid value");
}

/*************************************************************************************************
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE file in the project root for license information.
 *************************************************************************************************/

import * as path from "path";
import * as fs from "fs";
import { promisify } from "util";
import * as ghCore from "@actions/core";
import * as jsYaml from "js-yaml";
import Oc from "./oc";
import { getTmpDir } from "./utils";

type KubeConfigUser = Readonly<{
    "client-certificate-data"?: string;
    "client-key-data"?: string;
    token?: string;
}>

type KubeConfig = Readonly<{
    apiVersion: string;
    clusters: [{
        cluster: {
            server: string;
        }
        name: string;
    }];
    contexts: [{
        context: {
            cluster: string;
            namespace?: string;
            user: string;
        };
        name: string;
    }];
    "current-context"?: string;
    kind: string;
    // preferences: {}
    users: [{
        name: string;
        user: KubeConfigUser;
    }]
}>

namespace KubeConfig {

    const KUBECONFIG_FILENAME = "oc-kubeconfig.yaml";
    const KUBECONFIG_ENVVAR = "KUBECONFIG";

    /**
     * Write out the current kubeconfig to a new file and export the `KUBECONFIG` env var to point to that file.
     * This allows other steps in the job to reuse the kubeconfig.
     *
     * @param namespace Set the current context's namespace to this, if set.
     */
    export async function exportKubeConfig(): Promise<string> {
        const kubeConfigRaw = await getKubeConfig();

        let kubeConfigYml = jsYaml.safeLoad(kubeConfigRaw) as KubeConfig | undefined;
        if (kubeConfigYml == null) {
            throw new Error(`Could not load Kubeconfig as yaml`);
        }
        kubeConfigYml = kubeConfigYml as KubeConfig;

        kubeConfigYml.users.forEach((user) => {
            const secretKeys: (keyof KubeConfigUser)[] = [ "client-certificate-data", "client-key-data", "token" ];
            secretKeys.forEach((key) => {
                const value = user.user[key]
                if (value) {
                    ghCore.debug(`Masking ${key}`);
                    ghCore.setSecret(value);
                }
            })
        });

        // TODO make this path configurable through env or input.
        const kubeConfigPath = path.resolve(getTmpDir(), KUBECONFIG_FILENAME);

        ghCore.info(`Writing out Kubeconfig to ${kubeConfigPath}`);
        await promisify(fs.writeFile)(kubeConfigPath, kubeConfigRaw);

        ghCore.startGroup("Kubeconfig contents");
        ghCore.info(kubeConfigRaw);
        ghCore.endGroup();

        ghCore.info(`Exporting ${KUBECONFIG_ENVVAR}=${kubeConfigPath}`)
        ghCore.exportVariable(KUBECONFIG_ENVVAR, kubeConfigPath);

        return kubeConfigPath;
    }

    /**
     * @returns the current context's kubeconfig as a string.
     */
    async function getKubeConfig(): Promise<string> {
        const ocOptions = Oc.getOptions({ flatten: "", minify: "true" });

        // The stdout must be hidden since the secrets are not yet known to the action, and have not yet been masked.
        const execResult = await Oc.exec([ Oc.Commands.Config, Oc.Commands.View, ...ocOptions ], { hideOutput: true });
        return execResult.out;
    }

    export async function setCurrentContextNamespace(namespace: string): Promise<void> {
        ghCore.info(`Set current context's namespace to "${namespace}"`);
        const ocOptions = Oc.getOptions({ current: "", namespace });

        await Oc.exec([ Oc.Commands.Config, Oc.Commands.Set_Context, ...ocOptions ], { failOnStdErr: true });
    }
}

export default KubeConfig;

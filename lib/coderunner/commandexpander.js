/*global require,module,process*/

const CommandBase = require("./commandbase");
const jshcommands = require("../commands");
const child_process = require("child_process");

class CommandExpander extends CommandBase {
    constructor() {
        super();
        this.stdout = undefined;
        this.stderr = undefined;
        this.status = undefined;
    }

    run(jsh) {
        // run synchronously and set this.stdout.data and this.stderr.data = output

        // we only support one command
        let env = (cmd) => {
            let ce = cmd.assigns || {};
            let se = jsh.shell.env;
            for (var k in se) {
                if (!(k in ce))
                    ce[k] = se[k];
            }
            return ce;
        };

        let len = this.commands.length;
        if (len != 1) {
            throw `CommandExpander with ${len} commands not supported`;
        }
        let cmd = this.commands[0];
        let jscmd;
        if ((jscmd = jshcommands.find(cmd.name))) {
            // run js command sync? not sure how yet
        } else {
            let o = child_process.spawnSync(cmd.name, cmd.args, { env: env(cmd), encoding: "utf8" });
            if (o.error) {
                throw o.error;
            }
            this.stdout = o.stdout;
            this.stderr = o.stderr;
            this.status = o.status;
        }
    }
};

module.exports = CommandExpander;

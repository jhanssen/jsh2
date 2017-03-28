/*global module,require*/

class Aliases
{
    constructor() {
        this.a = new Map();
    }

    show(alias) {
        if (alias == undefined) {
            // show all
            for (let a of this.a) {
                console.log(`${a[0]}="${a[1]}"`);
            }
        } else if (this.a.has(alias)) {
            let v = this.a.get(alias);
            console.log(`${alias}="${v}"`);
        }
    }

    set(alias, value) {
        this.a.set(alias, value);
    }

    get(alias) {
        return this.a.get(alias);
    }
};

function alias(jsh, ...args)
{
    if (!jsh.shell.aliases)
        jsh.shell.aliases = new Aliases();
    let aliases = jsh.shell.aliases;
    if (!args.length) {
        aliases.show();
    } else {
        for (let idx = 0; idx < args.length; ++idx) {
            let eq = args[idx].indexOf('=');
            if (eq == -1) {
                aliases.show(args[idx]);
            } else {
                let k = args[idx].substr(0, eq);
                let v = args[idx].substr(eq + 1);
                aliases.set(k, v);
            }
        }
    }
}

module.exports = alias;

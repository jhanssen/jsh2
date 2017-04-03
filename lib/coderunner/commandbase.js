/*global process,module*/

class CommandBase {
    constructor(opts) {
        this.vars = Object.create(null);
        this.commands = [];
        this.subscriptions = [];
        this.parent = undefined;
        this.status = undefined;
        this.key = 0;
        this.opts = opts;
    }

    add(cmd) {
        if (!cmd.name.length) {
            for (var k in cmd.assigns) {
                this.vars[k] = cmd.assigns[k];
            }
        } else {
            this.commands.push(cmd);
        }
    }

    subscribe(cb) {
        let k = this.key++;
        this.subscriptions.push({ k: k, cb: cb });
        if (this.status !== undefined) {
            process.nextTick(() => {
                cb(this.status);
            });
        }
        return k;
    }

    unsubscribe(key) {
        let subs = this.subscriptions;
        for (let i = 0; i < subs.length; ++i) {
            if (subs[i].k == key) {
                subs.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    setVariables(jsh) {
        // set variables in shell
        for (var k in this.vars) {
            jsh.shell.setvar(k, this.vars[k]);
        }
    }

    setParent(p) {
        this.parent = p;
    }

    _notify(status, parent) {
        if (!parent)
            status = this.status;
        // notify up the parent tree until we have subscriptions, or in the case of an undefined status all the way up
        let subs = this.subscriptions;
        process.nextTick(() => {
            for (let i = 0; i < subs.length; ++i)
                subs[i].cb(status);
        });
        if (this.parent && (!subs.length || status == undefined)) {
            this.parent._notify(status, true);
        }
    }
}

module.exports = CommandBase;

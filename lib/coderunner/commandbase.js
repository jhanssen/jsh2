/*global process,module*/

class CommandBase {
    constructor() {
        this.commands = [];
        this.subscriptions = [];
        this.childCommands = new Set();
        this.status = undefined;
        this.key = 0;
    }

    add(cmd) {
        this.commands.push(cmd);
    }

    addChildCommands(cmd) {
        this.childCommands.add(cmd);
        cmd.subscribe((status) => {
            if (this.status === undefined)
                this.status = status;
            this.childCommands.delete(cmd);
            if (!this.childCommands.size)
                this._notify();
        });
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

    _notify() {
        if (this.commands.length || this.childCommands.size)
            return;
        let subs = this.subscriptions;
        for (let i = 0; i < subs.length; ++i)
            subs[i].cb(this.status);
    }
}

module.exports = CommandBase;
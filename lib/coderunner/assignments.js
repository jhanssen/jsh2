/*global module*/

class Assignments {
    constructor() {
        this.assignments = [];
    }

    push(assignment) {
        this.assignments.push(assignment);
    }

    pop(assignment) {
        this.assignments.pop();
    }

    get(key) {
        for (let i = this.assignments.length - 1; i >= 0; --i) {
            let a = this.assignments[i];
            if (key in a)
                return a[key];
        }
        return undefined;
    }

    flatten() {
        let ret = {};
        for (let i = 0; i < this.assignments.length; ++i) {
            for (var k in this.assignments[i]) {
                ret[k] = this.assignments[i][k];
            }
        }
        return ret;
    }

    clone() {
        // copy the objects
        let dup = (obj) => {
            let out = {};
            for (let k in obj) {
                out[k] = obj[k];
            }
            return out;
        };

        let out = [];
        for (let i = 0; i < this.assignments.length; ++i) {
            out.push(dup(this.assignments[i]));
        }
        return out;
    }
}

module.exports = Assignments;

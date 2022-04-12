'use strict';

// return [str(value), [element]]
Array.prototype.groupBy = function(f) {
    const o = {};
    Object(this).forEach(e => {
        const k = f(e);
        (k in o) ? o[k].push(e) : (o[k] = [e]);
    });
    const a = [];
    for (let k in o) {
        a.push([k, o[k]]);
    }
    return a;
};
// return an element in array
Array.prototype.maxBy = function(f) {
    return Object(this).reduce((a, b) => f(a) > f(b) ? a : b);
};
// return an element in array
Array.prototype.minBy = function(f) {
    return Object(this).reduce((a, b) => f(a) < f(b) ? a : b);
};
// return an element in array
Array.prototype.max = function() {
    return Object(this).reduce((a, b) => (a > b) ? a : b);
};
// return an element in array
Array.prototype.min = function() {
    return Object(this).reduce((a, b) => (a < b) ? a : b);
};
// return an array
Array.prototype.flat = function() {
    return Object(this).reduce((o, e) => {
        return o.concat(e);
    }, []);
};
// return true or false
Array.prototype.has = function(e) {
    return Object(this).indexOf(e) !== -1;
}
// return an array with no duplicate according to f
// O(n ^ 2), can be optimized to O(nlogn)
Array.prototype.unique = function(f) {
    const r = [];
    Object(this).forEach(e => {
        if (r.some(re => 
            f(re) !== undefined && f(e) !== undefined && f(re) === f(e))) {
            return;
        }
        r.push(e);
    });
    return r;
}
//const a = [ {b: 1}, {b:1}, {b:2}, {c:3}, {c:4}, {c:3} ];
//console.log(a.unique(e => e.c));

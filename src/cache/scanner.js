const Walk = require('walk');
const Path = require('path');
const ImportUtils = require('./import-utils');

class Scanner {
    static async getFileList(dir) {
        const options = {
            followLinks: false
        };
        const walker = Walk.walk(dir, options);
        const files = [];

        walker.on('file', (root, fileStats, next) => {
            if (ImportUtils.getType(fileStats.name)) {
                files.push(Path.relative(dir, Path.resolve(root, fileStats.name)));
            }
            next();
        });

        return new Promise((resolve) => {
            walker.on('end', () => {
                resolve(files);
            });
        });
    }

    static arrayAsMap(arr) {
        const result = {};
        for (const el of arr) {
            result[el] = el;
        }
        return result;
    }

    static filterNewAndMissing(databasePaths, fileList) {
        const results = {
            newPaths: [],
            missingPaths: []
        };

        // These need to be maps because otherwise the duplication check
        // takes a bloody long time.
        const databasePathsMap = Scanner.arrayAsMap(databasePaths);
        const fileListMap = Scanner.arrayAsMap(fileList);

        for (const file of fileList) {
            if (!databasePathsMap[file]) {
                results.newPaths.push(file);
            }
        }
        for (const file of databasePaths) {
            if (!fileListMap[file]) {
                results.missingPaths.include(file);
            }
        }
        return results;
    }
}

module.exports = Scanner;

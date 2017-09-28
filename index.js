/*!
 * V-Codemirror v1.0.0
 * (c) 2016-2017 ulivz <Luke Chen>
 * Released under the MIT License.
 */
const chalk = require('chalk')
const inquirer = require('inquirer')
const Prompt = inquirer.prompt
const exec = require('shelljs').exec
const path = require('path')
const ora = require('ora')
const fs = require('fs')
const pkg = require(path.resolve(process.cwd(), 'package.json'))
const EventEmitter = require('events').EventEmitter

/**
 * log normal msg with label
 *
 * @param msg
 * @param label
 */
function log(msg, label) {
  console.log(label, msg)
}

function success(msg) {
  log(msg, chalk.green('success'))
}

function error(msg) {
  log(msg, chalk.red('error'))
}

function warn(msg) {
  log(msg, chalk.yellow('warn'))
}

function info(msg) {
  log(msg, chalk.cyan('info'))
}

/**
 * Control the program exit with error or not
 */
function exit1() {
  process.exit(1)
}

function exit0() {
  process.exit(0)
}

/**
 * Get the next version based on current version
 *
 * @param oldVersion
 * @returns {{S_Version: string, M_Version: string, L_Version: string, LIST: [*,*,*]}}
 */
function newVersion(oldVersion) {

  if (!/^\d\.\d\.\d$/.test(oldVersion)) {
    throw new Error('Invalid version')
  }

  function parseVersion() {
    return oldVersion.split('.').map(str => parseInt(str))
  }

  const serializedVersion = parseVersion(oldVersion)
  let L, M, S

  L = serializedVersion[0]
  M = serializedVersion[1]
  S = serializedVersion[2]

  const S_Version = [L, M, ++S].join('.')
  const M_Version = [L, ++M, 0].join('.')
  const L_Version = [++L, 0, 0].join('.')

  return {
    S_Version,
    M_Version,
    L_Version,
    LIST: [S_Version,
      M_Version,
      L_Version]
  }
}


function parallelExec(tasklist) {
  return Promise.all(tasklist.map(task => {
    return new Promise(resolve => {
      exec(task.command, (code, stdout, stderr) => {
        if (code === 0 && task.check(stdout)) {
          resolve()
        } else {
          error(task.errorlog)
          exit1()
        }
      })
    })
  }))
}

/**
 * Main release method
 *
 * @param opts
 * @returns {*}
 */
function release(opts) {
  const Event = new EventEmitter()
  opts = Object.assign({
    beforeRelease: null,
  }, opts)

  const NEXT_VERSION = newVersion(pkg.version).LIST

  const PROMPTS = {
    confirmVersion(version) {
      return {
        type: 'confirm',
        name: 'isReady',
        message: `Current version: ${pkg.version}, Please confirm if all ready to release ?`,
      }
    },
    releaseVersion(versions) {
      return {
        type: 'list',
        name: 'version',
        message: 'Choose a release version',
        choices: versions
      }
    },
    releaseTag(defaultTag) {
      return {
        type: 'input',
        name: 'tag',
        message: 'Input a release tag',
        default: defaultTag
      }
    }
  }

  parallelExec([
    {
      command: 'git status',
      check: stdout => stdout.toString().indexOf('fatal') === -1,
      errorlog: 'Cannot find a git project!'
    },
    {
      command: 'git remote -v',
      check: stdout => stdout.toString().trim().length > 0,
      errorlog: 'No remote repository!'
    }

  ]).then(() => {
    Event.emit('pass_check')
  })

  let $VERSION, $RELEASE_TAG

  Event.on('start_release', function () {
    return Prompt([PROMPTS.confirmVersion(pkg.version)])
      .then(answers => {
        if (answers.isReady) {
          return Prompt([PROMPTS.releaseVersion(NEXT_VERSION)])
        } else {
          info('Canceled release')
          exit0()
        }
      })
      .then(answers => {
        $VERSION = answers.version
        return Prompt([PROMPTS.releaseTag(`v${$VERSION}`)])
      })
      .then(answers => {
        $RELEASE_TAG = answers.tag
        const spinner = ora(`Start to release "${pkg.name} ${$VERSION}"`).start()

        // spinner.info('Update version in package.json ...')
        // exec(`npm version ${$VERSION}`)

        // Commit
        spinner.info('Create a release commit ...')
        exec('git add -A')
        exec(`git commit -m "[build] v${$VERSION}"`)
        exec(`npm --no-git-tag-version version ${$VERSION} --message "[release] ${$VERSION} ${$RELEASE_TAG}"`)

        // Changelog
        spinner.info('Update CHANGLOG ...')
        exec('node_modules/.bin/conventional-changelog -p angular -i CHANGELOG.md -s')
        exec('git add .')
        exec(`git commit -m "chore: update CHANGLOG ${$VERSION}"`)

        // Publish
        spinner.info('Publishing ....')
        exec(`git tag v${$VERSION}`)
        exec(`git push origin refs/tags/v${$VERSION}`, (code, stdout, stderr) => {
          if (code === 0) {
            spinner.succeed('Released to Github successfully')
            spinner.info('Release to NPM ....')
            exec('git push')
            // TODO add tag for npm
            // if ($RELEASE_TAG) {
            //   exec(`npm publish --tag ${$RELEASE_TAG}`)
            // } else {
            exec('npm publish')
            // }
          } else {
            spinner.fail('Failed to released to Github, Please see above error message.')
          }
        })
      })
      success('Release finished')
  })

  Event.on('pass_check', function () {
    if (opts.beforeRelease) {
      Event.emit('before_release')
      if (typeof opts.beforeRelease === 'function') {

        opts.beforeRelease()
        Event.emit('start_release')

      } else if (opts.beforeRelease.then) {
        opts.beforeRelease.then(() => {
          Event.emit('start_release')
        })

      } else if (typeof opts.beforeRelease === 'string') {
        exec(opts.beforeRelease, (code, stdout, stderr) => {
          if (code === 0) {
            Event.emit('start_release')
            console.log(stdout)
          } else {
            console.log(stderr)
            console.log()
            error('Please check your beforeRelease task')
            exit1()
          }
        })
      }

    } else {
      Event.emit('start_release')
    }
  })

  return Event
}

module.exports = release

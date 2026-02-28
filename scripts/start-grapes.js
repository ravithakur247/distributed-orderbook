#!/usr/bin/env node
'use strict'

/**
 * start-grapes.js
 * Spawns both Grape DHT nodes as child processes.
 * Run this FIRST before starting any peers.
 *
 * Usage: npm run grapes
 */

const { spawn } = require('child_process')
const config = require('../config/config.json')

console.log('🍇 Starting Grape DHT network...\n')

const processes = []

config.grapes.forEach(grape => {
    const args = [
        '--dp', grape.dhtPort,
        '--aph', grape.announcePort,
        '--bn', grape.bootstrap
    ]

    console.log(`Starting ${grape.id}: grape ${args.join(' ')}`)

    const proc = spawn('grape', args, { stdio: 'inherit' })

    proc.on('error', err => {
        if (err.code === 'ENOENT') {
            console.error('\n❌ "grape" command not found!')
            console.error('Install it with: npm install -g grenache-grape\n')
            process.exit(1)
        }
    })

    proc.on('exit', code => {
        if (code !== 0) console.log(`${grape.id} exited with code ${code}`)
    })

    processes.push(proc)
})

// Graceful shutdown — kill grapes when this process exits
process.on('SIGINT', () => {
    console.log('\n🛑 Stopping grapes...')
    processes.forEach(p => p.kill())
    process.exit(0)
})

process.on('SIGTERM', () => {
    processes.forEach(p => p.kill())
    process.exit(0)
})

console.log('\n✅ Grapes running. Press Ctrl+C to stop.')
console.log('Now open new terminals and run:')
console.log('  npm run peer:1')
console.log('  npm run peer:2')
console.log('  npm run peer:3\n')
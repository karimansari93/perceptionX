#!/usr/bin/env node

/**
 * Script to download Lucide icons as PNG files
 * Usage: node scripts/download-lucide-icons.js
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Employee Experience icons
const employeeIcons = [
    { name: 'target', label: 'Mission & Purpose', id: 'mission-purpose' },
    { name: 'award', label: 'Rewards & Recognition', id: 'rewards-recognition' },
    { name: 'users', label: 'Company Culture', id: 'company-culture' },
    { name: 'heart', label: 'Social Impact', id: 'social-impact' },
    { name: 'shield', label: 'Inclusion', id: 'inclusion' },
    { name: 'lightbulb', label: 'Innovation', id: 'innovation' },
    { name: 'coffee', label: 'Wellbeing & Balance', id: 'wellbeing-balance' },
    { name: 'crown', label: 'Leadership', id: 'leadership' },
    { name: 'lock', label: 'Security & Perks', id: 'security-perks' },
    { name: 'trending-up', label: 'Career Opportunities', id: 'career-opportunities' }
];

// Candidate Experience icons
const candidateIcons = [
    { name: 'file-text', label: 'Application Process', id: 'application-process' },
    { name: 'message-square', label: 'Candidate Communication', id: 'candidate-communication' },
    { name: 'clipboard-list', label: 'Interview Experience', id: 'interview-experience' },
    { name: 'message-circle', label: 'Candidate Feedback', id: 'candidate-feedback' },
    { name: 'user-check', label: 'Onboarding Experience', id: 'onboarding-experience' },
    { name: 'briefcase', label: 'Overall Candidate Experience', id: 'overall-candidate-experience' }
];

// Create output directories
const outputDir = path.join(__dirname, '..', 'public', 'icons');
const employeeDir = path.join(outputDir, 'employee-experience');
const candidateDir = path.join(outputDir, 'candidate-experience');

[outputDir, employeeDir, candidateDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

/**
 * Download SVG from Lucide CDN and convert to PNG using an external service
 * Note: This script downloads SVG files. For PNG conversion, you'll need to use
 * the HTML file or install sharp: npm install sharp
 */
function downloadSVG(iconName, outputPath) {
    return new Promise((resolve, reject) => {
        const url = `https://unpkg.com/lucide@latest/icons/${iconName}.svg`;
        const file = fs.createWriteStream(outputPath);
        
        https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            } else if (response.statusCode === 302 || response.statusCode === 301) {
                // Handle redirect
                file.close();
                fs.unlinkSync(outputPath);
                downloadSVG(iconName, outputPath).then(resolve).catch(reject);
            } else {
                file.close();
                fs.unlinkSync(outputPath);
                reject(new Error(`Failed to download ${iconName}: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            file.close();
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            reject(err);
        });
    });
}

/**
 * Download all icons
 */
async function downloadAllIcons() {
    console.log('Downloading Employee Experience icons...');
    for (const icon of employeeIcons) {
        const filename = `${icon.id}.svg`;
        const outputPath = path.join(employeeDir, filename);
        try {
            await downloadSVG(icon.name, outputPath);
            console.log(`✓ Downloaded: ${icon.label} (${icon.name})`);
        } catch (error) {
            console.error(`✗ Failed to download ${icon.label}:`, error.message);
        }
    }

    console.log('\nDownloading Candidate Experience icons...');
    for (const icon of candidateIcons) {
        const filename = `${icon.id}.svg`;
        const outputPath = path.join(candidateDir, filename);
        try {
            await downloadSVG(icon.name, outputPath);
            console.log(`✓ Downloaded: ${icon.label} (${icon.name})`);
        } catch (error) {
            console.error(`✗ Failed to download ${icon.label}:`, error.message);
        }
    }

    console.log('\n✓ All icons downloaded as SVG files!');
    console.log(`\nTo convert to PNG, you can:`);
    console.log(`1. Use the HTML file: open scripts/download-lucide-icons.html in your browser`);
    console.log(`2. Install sharp and use a conversion script`);
    console.log(`3. Use an online SVG to PNG converter`);
    console.log(`\nSVG files saved to:`);
    console.log(`  - Employee Experience: ${employeeDir}`);
    console.log(`  - Candidate Experience: ${candidateDir}`);
}

// Run the script
downloadAllIcons().catch(console.error);

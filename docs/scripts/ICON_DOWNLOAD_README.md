# Download Lucide Icons as PNG

This directory contains scripts to download the Lucide icons used for Employee Experience and Candidate Experience themes as PNG files.

## Icons Included

### Employee Experience Icons (10 icons)
1. **Target** - Mission & Purpose (`mission-purpose`)
2. **Award** - Rewards & Recognition (`rewards-recognition`)
3. **Users** - Company Culture (`company-culture`)
4. **Heart** - Social Impact (`social-impact`)
5. **Shield** - Inclusion (`inclusion`)
6. **Lightbulb** - Innovation (`innovation`)
7. **Coffee** - Wellbeing & Balance (`wellbeing-balance`)
8. **Crown** - Leadership (`leadership`)
9. **Lock** - Security & Perks (`security-perks`)
10. **TrendingUp** - Career Opportunities (`career-opportunities`)

### Candidate Experience Icons (6 icons)
1. **FileText** - Application Process (`application-process`)
2. **MessageSquare** - Candidate Communication (`candidate-communication`)
3. **ClipboardList** - Interview Experience (`interview-experience`)
4. **MessageCircle** - Candidate Feedback (`candidate-feedback`)
5. **UserCheck** - Onboarding Experience (`onboarding-experience`)
6. **Briefcase** - Overall Candidate Experience (`overall-candidate-experience`)

## Method 1: HTML Browser Method (Recommended - No Dependencies)

This is the easiest method and doesn't require any additional dependencies.

1. Open `download-lucide-icons.html` in your web browser
2. Click one of the download buttons:
   - **Download All Icons as PNG** - Downloads all 16 icons
   - **Download Employee Experience Icons** - Downloads only the 10 employee experience icons
   - **Download Candidate Experience Icons** - Downloads only the 6 candidate experience icons
3. The PNG files will be automatically downloaded to your Downloads folder

The icons will be downloaded as:
- `{icon-name}-{label}.png` (e.g., `target-mission-&-purpose.png`)

## Method 2: Node.js Script (SVG Download)

This script downloads the icons as SVG files from the Lucide CDN.

1. Run the script:
   ```bash
   node scripts/download-lucide-icons.js
   ```

2. SVG files will be saved to:
   - `public/icons/employee-experience/` - Employee Experience icons
   - `public/icons/candidate-experience/` - Candidate Experience icons

3. To convert SVG to PNG, you can:
   - Use the HTML file method above
   - Use an online converter like [CloudConvert](https://cloudconvert.com/svg-to-png)
   - Install `sharp` and create a conversion script

## Method 3: Using Sharp for PNG Conversion (Advanced)

If you want to convert SVG to PNG programmatically:

1. Install sharp:
   ```bash
   npm install sharp
   ```

2. Create a conversion script or modify `download-lucide-icons.js` to use sharp for conversion.

## Icon Specifications

- **Size**: 128x128 pixels (2x scale for retina)
- **Format**: PNG with transparent background
- **Source**: Lucide React Icons (v0.462.0)
- **Stroke Width**: 2px

## Notes

- The HTML method uses `html2canvas` which is already included in the project dependencies
- Icons are rendered at 64x64px and scaled to 128x128px for high-quality output
- All icons maintain their original Lucide styling and colors

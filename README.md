# doc2confluence

[![CI](https://github.com/eric4545/doc2confluence/actions/workflows/ci.yml/badge.svg)](https://github.com/eric4545/doc2confluence/actions/workflows/ci.yml)

A powerful command-line tool that converts documentation files (Markdown, AsciiDoc, CSV) to Confluence's Atlassian Document Format (ADF).

## Requirements

- Node.js 18 or higher

## Installation

You can install and use doc2confluence in several ways:


### Using NPX
```bash
npx github:eric4545/doc2confluence
```
For example:
```bash
npx github:eric4545/doc2confluence push docs/example.md
```

### Using Docker
```bash
# The simplest way: push a Markdown file directly to Confluence in one command
docker run --rm --env-file .env ghcr.io/eric4545/doc2confluence:latest \
  push https://raw.githubusercontent.com/your-org/your-repo/main/docs/example.md

# You can also pull the image first if you'll be using it multiple times
docker pull ghcr.io/eric4545/doc2confluence:latest

# Push a Markdown file directly to Confluence using environment variables
docker run --rm \
  -e CONFLUENCE_URL=https://your-domain.atlassian.net \
  -e CONFLUENCE_USERNAME=your-email@domain.com \
  -e CONFLUENCE_API_KEY=your-api-token \
  -e CONFLUENCE_SPACE=your-space-key \
  ghcr.io/eric4545/doc2confluence push https://raw.githubusercontent.com/your-org/your-repo/main/docs/example.md

# Or use an .env file with your Confluence credentials
docker run --rm --env-file .env \
  ghcr.io/eric4545/doc2confluence push https://raw.githubusercontent.com/your-org/your-repo/main/docs/example.md

# For debugging: convert Markdown to ADF JSON (outputs to stdout)
docker run --rm \
  ghcr.io/eric4545/doc2confluence convert https://raw.githubusercontent.com/your-org/your-repo/main/docs/example.md
```

The Docker image is designed to work with remote URLs, making it easy to push documentation directly from your GitHub repositories to Confluence without needing to mount local files.

## Getting Started

### Quick Start

1. **Create a Markdown file** (e.g., `docs/example.md`):
```markdown
# My Documentation

This is a sample documentation with various features:

## Table of Contents
- [Features](#features)
- [Examples](#examples)

## Features
- **Bold** and *italic* text
- Code blocks with syntax highlighting
- Tables and CSV data
- Images and attachments

## Examples

### Code Example
```javascript
function hello() {
  console.log('Hello, world!');
}
```

### Table Example
```csv
Name,Age,Role
John,30,Developer
Jane,28,Designer
```

### Image Example
![Diagram](images/architecture.png)
```

2. **Set up Confluence credentials** (create `.env` file):

#### For Confluence Cloud:
```env
CONFLUENCE_URL=https://your-domain.atlassian.net
CONFLUENCE_USERNAME=your-email@domain.com
CONFLUENCE_API_KEY=your-api-token
# Or use Personal Access Token (PAT) authentication
# CONFLUENCE_PAT=your-access-token
CONFLUENCE_SPACE=your-space-key
```

#### For Confluence Server/Data Center:
```env
CONFLUENCE_URL=https://your-confluence-server.com
CONFLUENCE_USERNAME=your-username
CONFLUENCE_API_KEY=your-api-token
CONFLUENCE_INSTANCE_TYPE=server
CONFLUENCE_SPACE=your-space-key
```

3. **Convert and push to Confluence**:
```bash
# Convert to ADF format
doc2conf convert docs/example.md

# Push directly to Confluence
doc2conf push docs/example.md
```

### Common Use Cases

1. **Converting a Single File**:
```bash
doc2conf convert docs/example.md
```

2. **Converting with Table of Contents**:
```bash
doc2conf convert docs/example.md --toc
```

3. **Pushing to a Specific Space**:
```bash
doc2conf push docs/example.md --space TEAM
```

4. **Using Markdown Macro Instead of ADF Conversion**:
```bash
# Keep original Markdown format using Confluence's Markdown macro
doc2conf push docs/example.md --use-markdown-macro
```

This option creates a Confluence page with a Markdown macro containing your original Markdown content,
rather than converting to ADF. This can be useful when:

- You want to preserve the exact Markdown syntax
- Your Markdown contains advanced features that don't convert well to ADF
- You prefer to edit the content as Markdown directly in Confluence
- You need to maintain the document in both Markdown files and Confluence

5. **Using Inline CSV Data**:
```markdown
# Data Analysis

Here's our latest metrics:

```csv;delimiter=|
Metric|Value|Change
Users|1,234|+15%
Revenue|$50K|+25%
```
```

6. **Importing External CSV Files**:
```markdown
# Monthly Report

![Monthly Data](data/monthly-stats.csv)
```

7. **Using YAML Front Matter for Metadata**:
```markdown
---
title: "Team Documentation"
space: "TEAM"
parentId: "123456"
labels:
  - documentation
  - team
useMarkdownMacro: true
generateToc: true
---

# Team Documentation

Content goes here...
```

8. **Working with Confluence Server/Data Center**:
```bash
# Create a page in a Confluence Server instance
doc2conf push docs/example.md --instance-type server
```

## Docker Security

The Docker image includes several security best practices:

1. **Multi-stage Build**: Uses a multi-stage build to minimize image size and reduce attack surface
2. **Minimal Base Image**: Uses Alpine Linux as a lightweight, security-focused base image
3. **Non-root User**: Runs as a non-privileged user to limit potential damage from container breakout
4. **Dependency Management**: Installs only production dependencies to minimize vulnerabilities
5. **Security Scanning**: All published images are automatically scanned for vulnerabilities, misconfigurations, and secrets using Trivy
6. **Immutable Tags**: Images are tagged with specific versions to ensure reproducibility and auditability
7. **Image Hardening**: Follows container security best practices including proper file permissions and layer optimization

The GitHub Container Registry (ghcr.io) automatically scans all images, and our CI/CD pipeline prevents deployment of images with critical vulnerabilities.

### Docker Image Details

- **Base Image**: node:18-alpine (Alpine-based for smaller size)
- **Exposed Services**: None (CLI tool only)
- **Runtime User**: Non-root user (docuser)
- **Image Size**: Optimized through multi-stage builds and dependency management
- **Supply Chain**: All dependencies are locked and verified during build

## Environment Variables

The following environment variables can be set in your `.env` file:

| Variable                   | Description                        | Default                          |
| -------------------------- | ---------------------------------- | -------------------------------- |
| `CONFLUENCE_URL`           | Your Confluence instance URL       | None (required)                  |
| `CONFLUENCE_USERNAME`      | Your Confluence username or email  | None (required for basic auth)   |
| `CONFLUENCE_API_KEY`       | Your Confluence API token          | None (required for basic auth)   |
| `CONFLUENCE_PAT`           | Personal Access Token for Cloud    | None (alternative to basic auth) |
| `CONFLUENCE_SPACE`         | Default space key                  | None                             |
| `CONFLUENCE_PARENT_ID`     | Default parent page ID             | None                             |
| `CONFLUENCE_INSTANCE_TYPE` | Instance type: 'cloud' or 'server' | 'cloud'                          |

### Best Practices

1. **File Organization**:
   - Keep documentation in a dedicated `docs/` directory
   - Use relative paths for images and CSV files
   - Group related files in subdirectories

2. **CSV Data**:
   - Use headers for better table formatting
   - Keep CSV files small and focused
   - Use inline CSV for small tables
   - Use file imports for larger datasets

3. **Images**:
   - Store images in an `images/` directory
   - Use descriptive filenames
   - Optimize images before uploading

4. **Version Control**:
   - Commit documentation with code
   - Use meaningful commit messages
   - Keep documentation up to date

## Development

### Setup Development Environment

1. **Clone the repository**:
```bash
git clone https://github.com/yourusername/doc2confluence.git
cd doc2confluence
```

2. **Install dependencies**:
```bash
npm install
```

3. **Build the project**:
```bash
npm run build
```

### Development Mode

You can run the CLI in development mode using `ts-node`:

```bash
# Run directly with ts-node
npm run dev -- convert docs/example.md

# Or use npx
npx ts-node src/cli.ts convert docs/example.md
```

### Development Scripts

- `npm run dev` - Run CLI in development mode
- `npm run watch` - Watch for changes and rebuild
- `npm run lint` - Run Biome linter
- `npm run lint:fix` - Fix linting issues with Biome
- `npm run format` - Format code with Biome
- `npm run check` - Run Biome format and lint checks with auto-fix
- `npm run ci` - Run Biome checks for CI environment
- `npm run test` - Run tests
- `npm run build` - Build the project

### Project Structure

```
doc2confluence/
├── src/
│   ├── cli.ts           # CLI entry point
│   ├── converter.ts     # Main conversion logic
│   ├── confluence.ts    # Confluence API client
│   ├── config.ts        # Configuration handling
│   └── formats/         # Format-specific converters
│       ├── index.ts
│       └── csv.ts
├── dist/               # Compiled output
├── tests/             # Test files
├── package.json
└── tsconfig.json
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- converter.test.ts
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## Features

- Convert Markdown files to Confluence ADF format
- Convert AsciiDoc files to Confluence ADF format
- Import CSV files as Confluence tables
- Automatic image upload support
- GitOps-friendly documentation management
- Support for Confluence metadata in frontmatter
- Dry-run mode to preview ADF output
- Schema validation against official ADF schema
- Support for inline cards and mentions
- Table of contents generation
- Code block syntax highlighting
- CSV table import in Markdown using relative links
- Support for Confluence macros and formatting
- Inline CSV data support using code blocks
- Support for both Confluence Cloud and Server/Data Center instances

## Usage

### Basic Usage
```bash
# Convert a Markdown file
doc2conf convert input.md

# Convert an AsciiDoc file
doc2conf convert input.adoc --format asciidoc

# Import a CSV file as a table
doc2conf convert data.csv --format csv

# Push to Confluence Cloud (default)
doc2conf push input.md

# Push to Confluence Server/Data Center
doc2conf push input.md --instance-type server
```

### CSV Import in Markdown

You can import CSV files directly in your Markdown using relative links:

```markdown
# My Documentation

Here's a table of data:

![Data Table](data/table.csv)

More content...
```

The CSV file will be automatically converted to a Confluence table with:
- Automatic header detection
- Proper column alignment
- Cell formatting
- Support for quoted values

The CSV path is relative to the location of your Markdown file. For example:
- `![Data](data.csv)` - CSV in the same directory
- `![Data](../data.csv)` - CSV in parent directory
- `![Data](data/table.csv)` - CSV in subdirectory

### Confluence Server/Data Center Support

doc2confluence supports both Confluence Cloud and Confluence Server/Data Center instances. There are some key differences in the APIs:

1. **Content Format**:
   - Cloud uses Atlassian Document Format (ADF)
   - Server/Data Center uses Confluence Storage Format (XHTML-based)

2. **API Endpoints**:
   - Cloud: Uses newer `/api/v2/...` endpoints
   - Server/Data Center: Uses `/rest/api/...` endpoints

3. **Authentication**:
   - Both support Basic Authentication with username/API token
   - Cloud additionally supports Personal Access Tokens (PAT)

To use with Confluence Server/Data Center:

```bash
# Option 1: Set it in your .env file
CONFLUENCE_INSTANCE_TYPE=server

# Option 2: Use the command line flag
doc2conf push input.md --instance-type server
```

Note that doc2confluence automatically handles the conversion between ADF and Storage Format, so you don't need to worry about the format differences.

### Command Options

#### Convert Command
```bash
doc2conf convert <input-file> [options]

Options:
  --output, -o <file>           Output file path
  --format <format>             Input format (markdown, asciidoc, csv)
  --toc                         Generate table of contents
  --inline-cards                Parse inline cards
  --upload-images               Upload images to Confluence
  --use-official-schema         Validate against official ADF schema
  --dry-run                     Preview ADF output without saving
```

#### Push Command
```bash
doc2conf push <input-file> [options]

Options:
  --space <key>                 Confluence space key
  --parent <id>                 Parent page ID
  --title <title>               Page title
  --format <format>             Input format (markdown, asciidoc, csv)
  --toc                         Generate table of contents
  --inline-cards                Parse inline cards
  --upload-images               Upload images to Confluence
  --use-official-schema         Validate against official ADF schema
```

## Input Formats

### Markdown
Standard Markdown syntax with support for:
- Headers
- Lists (ordered and unordered)
- Code blocks with syntax highlighting
- Tables
- Links and images
- Blockquotes
- Horizontal rules

### AsciiDoc
AsciiDoc syntax with support for:
- All standard AsciiDoc features
- Tables with advanced formatting
- Cross-references
- Callouts
- Custom attributes
- Includes

### CSV
CSV files are converted to Confluence tables with:
- Automatic header detection
- Column alignment
- Cell formatting
- Support for quoted values
- Custom delimiters

## Configuration

Create a `.env` file in your project root:

### Option 1: Basic Authentication (Email/Username + API Token)
```env
CONFLUENCE_URL=https://your-domain.atlassian.net
# You can use either CONFLUENCE_EMAIL or CONFLUENCE_USERNAME
CONFLUENCE_EMAIL=your-email@domain.com
# You can use either CONFLUENCE_API_TOKEN or CONFLUENCE_API_KEY
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_SPACE=your-space-key
CONFLUENCE_PARENT_ID=your-parent-page-id
# For Server/Data Center, set this to 'server'
CONFLUENCE_INSTANCE_TYPE=cloud
```

### Option 2: Personal Access Token Authentication
```env
CONFLUENCE_URL=https://your-domain.atlassian.net
# You can use either CONFLUENCE_PAT or CONFLUENCE_PERSONAL_ACCESS_TOKEN
CONFLUENCE_PAT=your-personal-access-token
CONFLUENCE_SPACE=your-space-key
CONFLUENCE_PARENT_ID=your-parent-page-id
# For Server/Data Center, set this to 'server'
CONFLUENCE_INSTANCE_TYPE=cloud
```

### Server/Data Center Configuration
For Confluence Server/Data Center instances:

```env
# For Confluence Server/Data Center
CONFLUENCE_URL=https://your-confluence-server.example.com
CONFLUENCE_USERNAME=your-username
CONFLUENCE_API_KEY=your-api-token-or-password
CONFLUENCE_INSTANCE_TYPE=server
CONFLUENCE_SPACE=your-space-key
```

Note: Some Confluence Server/Data Center versions support Personal Access Tokens. If your instance supports PAT, you can use that authentication method instead.

For more information on creating Personal Access Tokens in Atlassian, see their [official documentation](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html).

## Environment Variables

| Variable                           | Description                        | Default                          |
| ---------------------------------- | ---------------------------------- | -------------------------------- |
| `CONFLUENCE_URL`                   | Your Confluence instance URL       | None (required)                  |
| `CONFLUENCE_USERNAME`              | Your Confluence username/email     | None (required for basic auth)   |
| `CONFLUENCE_EMAIL`                 | Alternative to USERNAME            | None                             |
| `CONFLUENCE_API_KEY`               | Your Confluence API token          | None (required for basic auth)   |
| `CONFLUENCE_API_TOKEN`             | Alternative to API_KEY             | None                             |
| `CONFLUENCE_PAT`                   | Personal Access Token              | None (alternative to basic auth) |
| `CONFLUENCE_PERSONAL_ACCESS_TOKEN` | Alternative to PAT                 | None                             |
| `CONFLUENCE_SPACE`                 | Default space key                  | None                             |
| `CONFLUENCE_PARENT_ID`             | Default parent page ID             | None                             |
| `CONFLUENCE_INSTANCE_TYPE`         | Instance type: 'cloud' or 'server' | 'cloud'                          |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

### Using YAML Front Matter

You can include Confluence metadata directly in your Markdown files using YAML front matter at the beginning of the file:

```markdown
---
title: "My Documentation"
space: "TEAM"
parentId: "123456"
labels:
  - documentation
  - example
  - markdown
useMarkdownMacro: true
generateToc: true
---

# Content starts here

Regular markdown content...
```

Available front matter options:

| Option             | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `title`            | The title of the page in Confluence                           |
| `space`            | The key of the Confluence space                               |
| `parentId`         | The ID of the parent page                                     |
| `pageId`           | The ID of an existing page to update                          |
| `labels`           | An array of labels to add to the page                         |
| `useMarkdownMacro` | If true, uses Markdown macro instead of converting to ADF     |
| `generateToc`      | If true, generates a table of contents at the top of the page |

Front matter values take precedence over command line options, except when you explicitly provide command line options.

```bash
# Use metadata from front matter
doc2conf push docs/example.md

# Override front matter title with command line option
doc2conf push docs/example.md --title "New Title"
```

## CLI Options

+### Global Options

+| Option             | Description                                    |
+| ------------------ | ---------------------------------------------- |
+| `--debug`          | Enable debug mode with detailed logging        |
+| `--help`, `-h`     | Display help information                       |
+| `--version`, `-v`  | Display version information                    |

+### Convert Command Options

+| Option                  | Description                                              |
+| ----------------------- | -------------------------------------------------------- |
+| `-o, --output <file>`   | Output file path                                         |
+| `-f, --format <format>` | Input format (markdown, asciidoc, csv)                   |
+| `--toc`                 | Generate table of contents                               |
+| `--inline-cards`        | Parse inline cards                                       |
+| `--upload-images`       | Upload images to Confluence                              |
+| `--use-official-schema` | Validate against official ADF schema                     |
+| `--dry-run`             | Preview ADF output without saving                        |
+| `--instance-type <type>`| Confluence instance type (cloud or server)               |
+| `--use-markdown-macro`  | Use Markdown macro instead of converting to ADF          |

+### Push Command Options

+| Option                  | Description                                              |
+| ----------------------- | -------------------------------------------------------- |
+| `-s, --space <key>`     | Confluence space key                                     |
+| `-p, --parent <id>`     | Parent page ID                                           |
+| `-t, --title <title>`   | Page title                                               |
+| `-f, --format <format>` | Input format (markdown, asciidoc, csv)                   |
+| `--toc`                 | Generate table of contents                               |
+| `--inline-cards`        | Parse inline cards                                       |
+| `--upload-images`       | Upload images to Confluence                              |
+| `--use-official-schema` | Validate against official ADF schema                     |
+| `--instance-type <type>`| Confluence instance type (cloud or server)               |
+| `--use-markdown-macro`  | Use Markdown macro instead of converting to ADF          |

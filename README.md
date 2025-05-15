# doc2confluence

A powerful command-line tool that converts documentation files (Markdown, AsciiDoc, CSV) to Confluence's Atlassian Document Format (ADF).

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
```env
CONFLUENCE_URL=https://your-domain.atlassian.net
CONFLUENCE_EMAIL=your-email@domain.com
CONFLUENCE_API_TOKEN=your-api-token
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

4. **Using Inline CSV Data**:
```markdown
# Data Analysis

Here's our latest metrics:

```csv;delimiter=|
Metric|Value|Change
Users|1,234|+15%
Revenue|$50K|+25%
```
```

5. **Importing External CSV Files**:
```markdown
# Monthly Report

![Monthly Data](data/monthly-stats.csv)
```

6. **Using YAML Front Matter for Metadata**:
```markdown
---
title: "Team Documentation"
space: "TEAM"
parentId: "123456"
labels:
  - documentation
  - team
---

# Team Documentation

Content goes here...
```

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
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
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

## Usage

### Basic Usage
```bash
# Convert a Markdown file
doc2conf convert input.md

# Convert an AsciiDoc file
doc2conf convert input.adoc --format asciidoc

# Import a CSV file as a table
doc2conf convert data.csv --format csv

# Push to Confluence
doc2conf push input.md
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

### Inline CSV
You can also include CSV data directly in your Markdown using code blocks:

```markdown
# My Documentation

Here's an inline table:

```csv
header1,header2
value1,value2
value3,value4
```

You can customize the CSV parsing with options:

```csv;delimiter=|;no-header
value1|value2
value3|value4
```

Available options:
- `delimiter=<char>` - Set custom delimiter (default: comma)
- `no-header` - Treat first row as data instead of header
- `skip-empty` - Skip empty lines

The CSV data will be automatically converted to a Confluence table with:
- Automatic header detection
- Proper column alignment
- Cell formatting
- Support for quoted values

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

```env
CONFLUENCE_URL=https://your-domain.atlassian.net
CONFLUENCE_EMAIL=your-email@domain.com
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_SPACE=your-space-key
CONFLUENCE_PARENT_ID=your-parent-page-id
```

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
---

# Content starts here

Regular markdown content...
```

Available front matter options:

| Option     | Description                           |
| ---------- | ------------------------------------- |
| `title`    | The title of the page in Confluence   |
| `space`    | The key of the Confluence space       |
| `parentId` | The ID of the parent page             |
| `pageId`   | The ID of an existing page to update  |
| `labels`   | An array of labels to add to the page |

Front matter values take precedence over command line options, except when you explicitly provide command line options.

```bash
# Use metadata from front matter
doc2conf push docs/example.md

# Override front matter title with command line option
doc2conf push docs/example.md --title "New Title"
```
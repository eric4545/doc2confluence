/**
 * Validates Confluence Wiki Markup for common syntax errors
 */

export interface ValidationError {
  line: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validates Confluence Wiki Markup content
 * @param content The wiki markup content to validate
 * @returns ValidationResult with any errors or warnings found
 */
export function validateWikiMarkup(content: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const lines = content.split('\n');

  // Track macro stack for balanced checking
  const macroStack: Array<{ name: string; line: number }> = [];

  // Check for common issues
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for unbalanced macros
    checkMacros(line, lineNum, macroStack, errors);

    // Check for empty lines in table cells (known issue from bug report)
    if (
      i > 0 &&
      isTableCell(lines[i - 1]) &&
      line.trim() === '' &&
      i < lines.length - 1 &&
      isTableCell(lines[i + 1])
    ) {
      warnings.push({
        line: lineNum,
        message: 'Empty line detected within table - this may cause rendering issues in Confluence',
        severity: 'warning',
        code: 'EMPTY_LINE_IN_TABLE',
      });
    }

    // Check for macros inside table cells with empty lines
    if (isTableCell(line) && line.includes('{markdown}')) {
      // Look ahead for empty lines before closing macro
      let j = i + 1;
      let hasEmptyLine = false;
      while (j < lines.length && !lines[j].includes('{markdown}')) {
        if (lines[j].trim() === '') {
          hasEmptyLine = true;
          break;
        }
        j++;
      }
      if (hasEmptyLine) {
        errors.push({
          line: lineNum,
          message: 'Macro in table cell contains empty lines - this will break table rendering',
          severity: 'error',
          code: 'MACRO_EMPTY_LINE_IN_TABLE',
        });
      }
    }

    // Check for invalid table syntax
    if (line.trim().startsWith('|') && !isValidTableRow(line)) {
      warnings.push({
        line: lineNum,
        message: 'Potentially malformed table row - check cell delimiters',
        severity: 'warning',
        code: 'MALFORMED_TABLE_ROW',
      });
    }
  }

  // Check for unclosed macros at end of document
  for (const macro of macroStack) {
    errors.push({
      line: macro.line,
      message: `Unclosed macro: {${macro.name}} - missing closing tag`,
      severity: 'error',
      code: 'UNCLOSED_MACRO',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Checks for macro opening and closing tags
 */
function checkMacros(
  line: string,
  lineNum: number,
  macroStack: Array<{ name: string; line: number }>,
  _errors: ValidationError[]
): void {
  // Match macro patterns: {macroName} or {macroName:param}
  const macroPattern = /\{([a-zA-Z][a-zA-Z0-9-]*)(:[^}]*)?\}/g;
  let match = macroPattern.exec(line);

  while (match !== null) {
    const macroName = match[1];

    // Check if this is a closing tag (same macro as last on stack)
    if (macroStack.length > 0 && macroStack[macroStack.length - 1].name === macroName) {
      // Closing tag
      macroStack.pop();
    } else {
      // Opening tag (or standalone macro like emoticons)
      // Only track macros that require closing tags
      if (requiresClosingTag(macroName)) {
        macroStack.push({ name: macroName, line: lineNum });
      }
    }
    match = macroPattern.exec(line);
  }
}

/**
 * Determines if a macro requires a closing tag
 */
function requiresClosingTag(macroName: string): boolean {
  const closedMacros = [
    'code',
    'markdown',
    'quote',
    'expand',
    'panel',
    'info',
    'note',
    'warning',
    'tip',
  ];
  return closedMacros.includes(macroName.toLowerCase());
}

/**
 * Checks if a line is a table cell
 */
function isTableCell(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') || trimmed.startsWith('||');
}

/**
 * Validates table row syntax
 */
function isValidTableRow(line: string): boolean {
  const trimmed = line.trim();

  // Must start with | or ||
  if (!trimmed.startsWith('|')) {
    return false;
  }

  // Should end with |
  if (!trimmed.endsWith('|')) {
    return false;
  }

  // Check for balanced delimiters (basic check)
  const pipeCount = (trimmed.match(/\|/g) || []).length;
  return pipeCount >= 2;
}

/**
 * Formats validation results as a readable string
 */
export function formatValidationResults(result: ValidationResult): string {
  if (result.valid && result.warnings.length === 0) {
    return 'Wiki markup validation passed with no errors or warnings.';
  }

  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push('\n❌ Errors:');
    for (const error of result.errors) {
      lines.push(`  Line ${error.line}: ${error.message} [${error.code}]`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('\n⚠️  Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  Line ${warning.line}: ${warning.message} [${warning.code}]`);
    }
  }

  return lines.join('\n');
}

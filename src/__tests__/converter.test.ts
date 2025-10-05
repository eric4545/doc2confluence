import assert from 'node:assert';
import fs from 'node:fs/promises';
import { describe, it, mock } from 'node:test';
import { Converter } from '../converter';
import type { ADFEntity } from '../types';

const converter = new Converter();

describe('CSV handling', () => {
  it('converts CSV file import to table', async () => {
    const markdown = '![csv](data/table.csv)';
    const mockCsvContent = 'header1,header2\nvalue1,value2';

    mock.method(fs, 'readFile', async () => mockCsvContent);

    const adf = await converter.convertToADF(markdown, { basePath: '/test' });
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);
    if (adf.content) {
      assert.ok(adf.content.length > 0);
    }
  });

  it('handles inline CSV data', async () => {
    const markdown = '```csv\nheader1,header2\nvalue1,value2\n```';

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);
    if (adf.content) {
      assert.strictEqual(adf.content[0].type, 'table');
      assert.strictEqual(adf.content[0].content?.length, 2);
    }
  });

  it('handles CSV with custom delimiter', async () => {
    const markdown = '```csv;delimiter=|\nheader1|header2\nvalue1|value2\n```';

    // Console log for debugging
    console.log('Testing CSV with custom delimiter:', markdown);

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);
    if (adf.content) {
      console.log('Got content type:', adf.content[0].type);
      assert.strictEqual(adf.content[0].type, 'table');
      assert.strictEqual(adf.content[0].content?.length, 2);
    }
  });

  it('handles CSV without headers', async () => {
    const markdown = '```csv;no-header\nvalue1,value2\nvalue3,value4\n```';

    // Console log for debugging
    console.log('Testing CSV without headers:', markdown);

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);
    if (adf.content) {
      console.log('Got content type:', adf.content[0].type);
      assert.strictEqual(adf.content[0].type, 'table');

      // With no-header, csv-parse still generates a header row with column indices
      // So the table has 3 rows: header row + 2 data rows
      assert.strictEqual(adf.content[0].content?.length, 3);

      // First row is the header row with column indices
      if (adf.content[0].content && adf.content[0].content.length > 0) {
        const headerRow = adf.content[0].content[0];
        assert.strictEqual(headerRow.type, 'tableRow');
        assert.ok(headerRow.content !== undefined);
        assert.strictEqual(headerRow.content?.length, 2); // 2 columns
      }
    }
  });

  it('handles empty CSV gracefully', async () => {
    const markdown = '```csv\n```'; // Represents an empty CSV block

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);
    if (adf.content && adf.content.length > 0) {
      assert.strictEqual(adf.content[0].type, 'table');
      // For empty CSV, we return a table with an empty content array
      assert.deepStrictEqual(adf.content[0].content, []);
    }
  });

  it('handles malformed CSV gracefully', async () => {
    const markdown = '```csv\nheader1,header2\nvalue1\n```'; // Missing value for header2

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);
    if (adf.content && adf.content.length > 0) {
      assert.strictEqual(adf.content[0].type, 'table');
      assert.ok(adf.content[0].content !== undefined);
      if (adf.content[0].content) {
        assert.ok(adf.content[0].content.length > 0); // Should have at least a header row
      }

      // csv-parse will treat the missing value as empty string or undefined
      // The exact behavior depends on the csv-parse configuration,
      // but the converter should handle it without errors
    }
  });
});

describe('Task List handling', () => {
  it('converts top-level task lists', async () => {
    const markdown = `# Task Lists
- [ ] Uncompleted task
- [x] Completed task`;

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);

    // Find the task list in the content
    const taskList = adf.content?.find((node) => node.type === 'taskList');
    assert.ok(taskList !== undefined);

    if (taskList?.content) {
      // Should have two task items
      assert.strictEqual(taskList.content.length, 2);

      // Check first task (uncompleted)
      const firstTask = taskList.content[0];
      assert.strictEqual(firstTask.type, 'taskItem');
      assert.strictEqual((firstTask.attrs as { state: string })?.state, 'TODO');

      // Check second task (completed)
      const secondTask = taskList.content[1];
      assert.strictEqual(secondTask.type, 'taskItem');
      assert.strictEqual((secondTask.attrs as { state: string })?.state, 'DONE');
    }
  });

  it('converts nested task lists', async () => {
    const markdown = `# Nested Tasks
- Regular list item
  - [ ] Nested uncompleted task
  - [x] Nested completed task`;

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);

    // Find the bullet list in the content
    const bulletList = adf.content?.find((node) => node.type === 'bulletList');
    assert.ok(bulletList !== undefined);

    if (bulletList?.content && bulletList.content.length > 0) {
      const listItem = bulletList.content[0];
      assert.strictEqual(listItem.type, 'listItem');

      // The list item should have a paragraph and a task list
      assert.ok(listItem.content !== undefined);
      assert.ok(listItem.content?.length > 1);

      // Find the task list within the list item content
      const nestedTaskList = listItem.content?.find((node) => node.type === 'taskList');
      assert.ok(nestedTaskList !== undefined);

      if (nestedTaskList?.content) {
        // Should have two task items
        assert.strictEqual(nestedTaskList.content.length, 2);

        // Check first nested task (uncompleted)
        const firstTask = nestedTaskList.content[0];
        assert.strictEqual(firstTask.type, 'taskItem');
        assert.strictEqual((firstTask.attrs as { state: string })?.state, 'TODO');

        // Check second nested task (completed)
        const secondTask = nestedTaskList.content[1];
        assert.strictEqual(secondTask.type, 'taskItem');
        assert.strictEqual((secondTask.attrs as { state: string })?.state, 'DONE');
      }
    }
  });

  it('converts numbered task lists', async () => {
    const markdown = `# Numbered Tasks
1. [ ] First numbered task
2. [x] Second numbered task`;

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);

    // Find the task list in the content (should convert to taskList, not orderedList)
    const taskList = adf.content?.find((node) => node.type === 'taskList');
    assert.ok(taskList !== undefined);

    if (taskList?.content) {
      // Should have two task items
      assert.strictEqual(taskList.content.length, 2);

      // Check first task (uncompleted)
      const firstTask = taskList.content[0];
      assert.strictEqual(firstTask.type, 'taskItem');
      assert.strictEqual((firstTask.attrs as { state: string })?.state, 'TODO');

      // Check second task (completed)
      const secondTask = taskList.content[1];
      assert.strictEqual(secondTask.type, 'taskItem');
      assert.strictEqual((secondTask.attrs as { state: string })?.state, 'DONE');
    }
  });

  it('converts task lists inside nested numbered lists', async () => {
    const markdown = `# Nested Numbered Tasks
- Regular list item
  1. [ ] Nested numbered uncompleted task
  2. [x] Nested numbered completed task`;

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);

    // Find the bullet list in the content
    const bulletList = adf.content?.find((node) => node.type === 'bulletList');
    assert.ok(bulletList !== undefined);

    if (bulletList?.content && bulletList.content.length > 0) {
      const listItem = bulletList.content[0];
      assert.strictEqual(listItem.type, 'listItem');

      // Find the task list within the list item content
      const nestedTaskList = listItem.content?.find((node) => node.type === 'taskList');
      assert.ok(nestedTaskList !== undefined);

      if (nestedTaskList?.content) {
        // Should have two task items
        assert.strictEqual(nestedTaskList.content.length, 2);

        // Check first nested numbered task (uncompleted)
        const firstTask = nestedTaskList.content[0];
        assert.strictEqual(firstTask.type, 'taskItem');
        assert.strictEqual((firstTask.attrs as { state: string })?.state, 'TODO');

        // Check second nested numbered task (completed)
        const secondTask = nestedTaskList.content[1];
        assert.strictEqual(secondTask.type, 'taskItem');
        assert.strictEqual((secondTask.attrs as { state: string })?.state, 'DONE');
      }
    }
  });

  it('converts task list items with formatted text', async () => {
    const markdown = `# Formatted Task Items
- [ ] **Bold task**
- [ ] *Italic task*
- [ ] ~~Strikethrough task~~
- [ ] __Underscored text__`;

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);

    // Find the task list in the content
    const taskList = adf.content?.find((node) => node.type === 'taskList');
    assert.ok(taskList !== undefined);

    if (taskList?.content) {
      // Should have four task items
      assert.strictEqual(taskList.content.length, 4);

      // Check that task items have proper content and formatting
      taskList.content.forEach((task, index) => {
        assert.strictEqual(task.type, 'taskItem');
        // Cast content to ADFEntity[] to access array elements
        const content = task.content as ADFEntity[];
        assert.strictEqual(content[0].type, 'text');

        // Check specific formatting marks
        if (index === 0) {
          // Bold task should have strong mark
          assert.strictEqual((content[0].marks as ADFEntity[])[0].type, 'strong');
        } else if (index === 1) {
          // Italic task should have em mark
          assert.strictEqual((content[0].marks as ADFEntity[])[0].type, 'em');
        } else if (index === 2) {
          // Strikethrough task should have strike mark
          assert.strictEqual((content[0].marks as ADFEntity[])[0].type, 'strike');
        } else if (index === 3) {
          // Underscored text should have em mark
          assert.strictEqual((content[0].marks as ADFEntity[])[0].type, 'em');
        }
      });
    }
  });

  it('converts formatted text in nested task lists', async () => {
    const markdown = `# Nested Formatted Tasks
- Regular list item
  - [ ] **Bold nested task**
  - [ ] ~~Strikethrough nested task~~
  - [ ] *Italic nested task*`;

    const adf = await converter.convertToADF(markdown);
    assert.strictEqual(adf.type, 'doc');
    assert.ok(adf.content !== undefined);

    // Find the bullet list in the content
    const bulletList = adf.content?.find((node) => node.type === 'bulletList');
    assert.ok(bulletList !== undefined);

    if (bulletList?.content && bulletList.content.length > 0) {
      const listItem = bulletList.content[0];
      assert.strictEqual(listItem.type, 'listItem');

      // Find the task list within the list item content
      const nestedTaskList = listItem.content?.find((node) => node.type === 'taskList');
      assert.ok(nestedTaskList !== undefined);

      if (nestedTaskList?.content) {
        // Should have three nested task items
        assert.strictEqual(nestedTaskList.content.length, 3);

        // First task with bold formatting
        const firstTask = nestedTaskList.content[0];
        assert.strictEqual(firstTask.type, 'taskItem');
        const firstTaskContent = firstTask.content as ADFEntity[];
        assert.strictEqual(firstTaskContent[0].type, 'text');
        assert.strictEqual((firstTaskContent[0].marks as ADFEntity[])[0].type, 'strong');

        // Second task with strikethrough formatting
        const secondTask = nestedTaskList.content[1];
        const secondTaskContent = secondTask.content as ADFEntity[];
        assert.strictEqual(secondTaskContent[0].type, 'text');
        assert.strictEqual((secondTaskContent[0].marks as ADFEntity[])[0].type, 'strike');

        // Third task with italic formatting
        const thirdTask = nestedTaskList.content[2];
        const thirdTaskContent = thirdTask.content as ADFEntity[];
        assert.strictEqual(thirdTaskContent[0].type, 'text');
        assert.strictEqual((thirdTaskContent[0].marks as ADFEntity[])[0].type, 'em');
      }
    }
  });
});

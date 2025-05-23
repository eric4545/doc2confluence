import fs from 'node:fs/promises';
import { Converter } from '../converter';
import type { ADFEntity } from '../types';

const converter = new Converter();

describe('CSV handling', () => {
  test('converts CSV file import to table', async () => {
    const markdown = '![csv](data/table.csv)';
    const mockCsvContent = 'header1,header2\nvalue1,value2';

    jest.spyOn(fs, 'readFile').mockResolvedValueOnce(mockCsvContent);

    const adf = await converter.convertToADF(markdown, { basePath: '/test' });
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();
    if (adf.content) {
      expect(adf.content.length).toBeGreaterThan(0);
    }
  });

  test('handles inline CSV data', async () => {
    const markdown = '```csv\nheader1,header2\nvalue1,value2\n```';

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();
    if (adf.content) {
      expect(adf.content[0].type).toBe('table');
      expect(adf.content[0].content).toHaveLength(2);
    }
  });

  test('handles CSV with custom delimiter', async () => {
    const markdown = '```csv;delimiter=|\nheader1|header2\nvalue1|value2\n```';

    // Console log for debugging
    console.log('Testing CSV with custom delimiter:', markdown);

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();
    if (adf.content) {
      console.log('Got content type:', adf.content[0].type);
      expect(adf.content[0].type).toBe('table');
      expect(adf.content[0].content).toHaveLength(2);
    }
  });

  test('handles CSV without headers', async () => {
    const markdown = '```csv;no-header\nvalue1,value2\nvalue3,value4\n```';

    // Console log for debugging
    console.log('Testing CSV without headers:', markdown);

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();
    if (adf.content) {
      console.log('Got content type:', adf.content[0].type);
      expect(adf.content[0].type).toBe('table');

      // With no-header, csv-parse still generates a header row with column indices
      // So the table has 3 rows: header row + 2 data rows
      expect(adf.content[0].content).toHaveLength(3);

      // First row is the header row with column indices
      if (adf.content[0].content && adf.content[0].content.length > 0) {
        const headerRow = adf.content[0].content[0];
        expect(headerRow.type).toBe('tableRow');
        expect(headerRow.content).toBeDefined();
        expect(headerRow.content?.length).toBe(2); // 2 columns
      }
    }
  });

  test('handles empty CSV gracefully', async () => {
    const markdown = '```csv\n```'; // Represents an empty CSV block

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();
    if (adf.content && adf.content.length > 0) {
      expect(adf.content[0].type).toBe('table');
      // For empty CSV, we return a table with an empty content array
      expect(adf.content[0].content).toEqual([]);
    }
  });

  test('handles malformed CSV gracefully', async () => {
    const markdown = '```csv\nheader1,header2\nvalue1\n```'; // Missing value for header2

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();
    if (adf.content && adf.content.length > 0) {
      expect(adf.content[0].type).toBe('table');
      expect(adf.content[0].content).toBeDefined();
      if (adf.content[0].content) {
        expect(adf.content[0].content.length).toBeGreaterThan(0); // Should have at least a header row
      }

      // csv-parse will treat the missing value as empty string or undefined
      // The exact behavior depends on the csv-parse configuration,
      // but the converter should handle it without errors
    }
  });
});

describe('Task List handling', () => {
  test('converts top-level task lists', async () => {
    const markdown = `# Task Lists
- [ ] Uncompleted task
- [x] Completed task`;

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();

    // Find the task list in the content
    const taskList = adf.content?.find((node) => node.type === 'taskList');
    expect(taskList).toBeDefined();

    if (taskList?.content) {
      // Should have two task items
      expect(taskList.content.length).toBe(2);

      // Check first task (uncompleted)
      const firstTask = taskList.content[0];
      expect(firstTask.type).toBe('taskItem');
      expect((firstTask.attrs as { state: string })?.state).toBe('TODO');

      // Check second task (completed)
      const secondTask = taskList.content[1];
      expect(secondTask.type).toBe('taskItem');
      expect((secondTask.attrs as { state: string })?.state).toBe('DONE');
    }
  });

  test('converts nested task lists', async () => {
    const markdown = `# Nested Tasks
- Regular list item
  - [ ] Nested uncompleted task
  - [x] Nested completed task`;

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();

    // Find the bullet list in the content
    const bulletList = adf.content?.find((node) => node.type === 'bulletList');
    expect(bulletList).toBeDefined();

    if (bulletList?.content && bulletList.content.length > 0) {
      const listItem = bulletList.content[0];
      expect(listItem.type).toBe('listItem');

      // The list item should have a paragraph and a task list
      expect(listItem.content).toBeDefined();
      expect(listItem.content?.length).toBeGreaterThan(1);

      // Find the task list within the list item content
      const nestedTaskList = listItem.content?.find((node) => node.type === 'taskList');
      expect(nestedTaskList).toBeDefined();

      if (nestedTaskList?.content) {
        // Should have two task items
        expect(nestedTaskList.content.length).toBe(2);

        // Check first nested task (uncompleted)
        const firstTask = nestedTaskList.content[0];
        expect(firstTask.type).toBe('taskItem');
        expect((firstTask.attrs as { state: string })?.state).toBe('TODO');

        // Check second nested task (completed)
        const secondTask = nestedTaskList.content[1];
        expect(secondTask.type).toBe('taskItem');
        expect((secondTask.attrs as { state: string })?.state).toBe('DONE');
      }
    }
  });

  test('converts numbered task lists', async () => {
    const markdown = `# Numbered Tasks
1. [ ] First numbered task
2. [x] Second numbered task`;

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();

    // Find the task list in the content (should convert to taskList, not orderedList)
    const taskList = adf.content?.find((node) => node.type === 'taskList');
    expect(taskList).toBeDefined();

    if (taskList?.content) {
      // Should have two task items
      expect(taskList.content.length).toBe(2);

      // Check first task (uncompleted)
      const firstTask = taskList.content[0];
      expect(firstTask.type).toBe('taskItem');
      expect((firstTask.attrs as { state: string })?.state).toBe('TODO');

      // Check second task (completed)
      const secondTask = taskList.content[1];
      expect(secondTask.type).toBe('taskItem');
      expect((secondTask.attrs as { state: string })?.state).toBe('DONE');
    }
  });

  test('converts task lists inside nested numbered lists', async () => {
    const markdown = `# Nested Numbered Tasks
- Regular list item
  1. [ ] Nested numbered uncompleted task
  2. [x] Nested numbered completed task`;

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();

    // Find the bullet list in the content
    const bulletList = adf.content?.find((node) => node.type === 'bulletList');
    expect(bulletList).toBeDefined();

    if (bulletList?.content && bulletList.content.length > 0) {
      const listItem = bulletList.content[0];
      expect(listItem.type).toBe('listItem');

      // Find the task list within the list item content
      const nestedTaskList = listItem.content?.find((node) => node.type === 'taskList');
      expect(nestedTaskList).toBeDefined();

      if (nestedTaskList?.content) {
        // Should have two task items
        expect(nestedTaskList.content.length).toBe(2);

        // Check first nested numbered task (uncompleted)
        const firstTask = nestedTaskList.content[0];
        expect(firstTask.type).toBe('taskItem');
        expect((firstTask.attrs as { state: string })?.state).toBe('TODO');

        // Check second nested numbered task (completed)
        const secondTask = nestedTaskList.content[1];
        expect(secondTask.type).toBe('taskItem');
        expect((secondTask.attrs as { state: string })?.state).toBe('DONE');
      }
    }
  });

  test('converts task list items with formatted text', async () => {
    const markdown = `# Formatted Task Items
- [ ] **Bold task**
- [ ] *Italic task*
- [ ] ~~Strikethrough task~~
- [ ] __Underscored text__`;

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();

    // Find the task list in the content
    const taskList = adf.content?.find((node) => node.type === 'taskList');
    expect(taskList).toBeDefined();

    if (taskList?.content) {
      // Should have four task items
      expect(taskList.content.length).toBe(4);

      // Check that task items have proper content and formatting
      taskList.content.forEach((task, index) => {
        expect(task.type).toBe('taskItem');
        // Cast content to ADFEntity[] to access array elements
        const content = task.content as ADFEntity[];
        expect(content[0].type).toBe('text');

        // Check specific formatting marks
        if (index === 0) {
          // Bold task should have strong mark
          expect((content[0].marks as ADFEntity[])[0].type).toBe('strong');
        } else if (index === 1) {
          // Italic task should have em mark
          expect((content[0].marks as ADFEntity[])[0].type).toBe('em');
        } else if (index === 2) {
          // Strikethrough task should have strike mark
          expect((content[0].marks as ADFEntity[])[0].type).toBe('strike');
        } else if (index === 3) {
          // Underscored text should have em mark
          expect((content[0].marks as ADFEntity[])[0].type).toBe('em');
        }
      });
    }
  });

  test('converts formatted text in nested task lists', async () => {
    const markdown = `# Nested Formatted Tasks
- Regular list item
  - [ ] **Bold nested task**
  - [ ] ~~Strikethrough nested task~~
  - [ ] *Italic nested task*`;

    const adf = await converter.convertToADF(markdown);
    expect(adf.type).toBe('doc');
    expect(adf.content).toBeDefined();

    // Find the bullet list in the content
    const bulletList = adf.content?.find((node) => node.type === 'bulletList');
    expect(bulletList).toBeDefined();

    if (bulletList?.content && bulletList.content.length > 0) {
      const listItem = bulletList.content[0];
      expect(listItem.type).toBe('listItem');

      // Find the task list within the list item content
      const nestedTaskList = listItem.content?.find((node) => node.type === 'taskList');
      expect(nestedTaskList).toBeDefined();

      if (nestedTaskList?.content) {
        // Should have three nested task items
        expect(nestedTaskList.content.length).toBe(3);

        // First task with bold formatting
        const firstTask = nestedTaskList.content[0];
        expect(firstTask.type).toBe('taskItem');
        const firstTaskContent = firstTask.content as ADFEntity[];
        expect(firstTaskContent[0].type).toBe('text');
        expect((firstTaskContent[0].marks as ADFEntity[])[0].type).toBe('strong');

        // Second task with strikethrough formatting
        const secondTask = nestedTaskList.content[1];
        const secondTaskContent = secondTask.content as ADFEntity[];
        expect(secondTaskContent[0].type).toBe('text');
        expect((secondTaskContent[0].marks as ADFEntity[])[0].type).toBe('strike');

        // Third task with italic formatting
        const thirdTask = nestedTaskList.content[2];
        const thirdTaskContent = thirdTask.content as ADFEntity[];
        expect(thirdTaskContent[0].type).toBe('text');
        expect((thirdTaskContent[0].marks as ADFEntity[])[0].type).toBe('em');
      }
    }
  });
});

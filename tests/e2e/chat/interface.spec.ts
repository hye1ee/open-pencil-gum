import { expect, test } from '@playwright/test'

test('chat route loads independently in the bright interface', async ({ page }) => {
  await page.goto('/chat')

  await expect(page).toHaveTitle('LenChat')
  await expect(page.getByTestId('lenchat-logo')).toBeVisible()
  await expect(page.getByText('LenChat', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'LenChat' })).toBeVisible()
  await expect(page.getByText('Back to design editor')).toHaveCount(0)
  await expect(page.getByText(/Chat with Gemini/)).toHaveCount(0)
  await expect(page.locator('#loader')).toHaveCount(0)
  await expect(page.getByTestId('conversation-input')).toBeVisible()
  await expect(page.getByTestId('editor-root')).toHaveCount(0)
  await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.getByTestId('conversation-shell')).toHaveCSS('user-select', 'text')
})

test('new chat and model settings are available without entering the editor', async ({ page }) => {
  await page.goto('/chat')

  await page.getByTitle('Model Setting').click()
  await expect(page.getByRole('heading', { name: 'Model Setting' })).toBeVisible()
  await expect(page.getByLabel('Gemini model')).toHaveValue('gemini-3.5-flash')
  await expect(page.getByRole('checkbox', { name: /Google Search/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Code execution/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /URL context/ })).toBeChecked()
  await expect(page.getByText('Model: Gemini 3.5 Flash')).toBeVisible()
  await expect(page.getByText('Tools:', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible()
})

test('user model drawer uses the concise title', async ({ page }) => {
  await page.goto('/chat')

  await page.getByTitle('User Model').click()
  await expect(page.getByRole('heading', { name: 'User Model' })).toBeVisible()
})

test('saved IndexedDB conversations appear in Recent and can be loaded', async ({ page }) => {
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'LenChat' })).toBeVisible()

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('open-pencil-chat', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('conversations', 'readwrite')
    const store = transaction.objectStore('conversations')
    const now = Date.now()
    store.put({
      id: 'saved-first',
      title: 'Saved first chat',
      messages: [
        { id: 'first-user', role: 'user', parts: [{ type: 'text', text: 'First question' }] },
        {
          id: 'first-assistant',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Check the saved conversation context.', state: 'done' },
            {
              type: 'tool-google_search',
              toolCallId: 'saved-search',
              state: 'output-available',
              input: { queries: ['saved conversation'] },
              output: { results: [] },
              providerExecuted: true
            },
            { type: 'text', text: 'First saved answer' }
          ]
        }
      ],
      createdAt: now - 2,
      updatedAt: now - 2
    })
    store.put({
      id: 'saved-latest',
      title: 'Saved latest chat',
      messages: [
        { id: 'latest-user', role: 'user', parts: [{ type: 'text', text: 'Latest question' }] },
        {
          id: 'latest-assistant',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Latest saved answer' }]
        }
      ],
      createdAt: now - 1,
      updatedAt: now - 1
    })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  })

  await page.reload()
  await expect(page.getByText('Latest saved answer')).toBeVisible()
  await page.getByRole('button', { name: 'Saved first chat' }).click()
  await expect(page.getByText('First saved answer')).toBeVisible()
  const savedAnswer = page.getByTestId('conversation-message-assistant')
  await savedAnswer.getByRole('button', { name: 'Reasoning' }).click()
  await expect(savedAnswer.getByText('Tools used')).toBeVisible()
  await expect(savedAnswer.getByText('Google Search')).toBeVisible()
  await page.getByTitle('Delete Saved first chat').click()
  await expect(page.getByRole('button', { name: 'Saved first chat' })).toHaveCount(0)
  await expect(page.getByText('Latest saved answer')).toBeVisible()
})

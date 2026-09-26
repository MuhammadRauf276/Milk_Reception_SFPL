export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const error = new Error(errorData.error || 'An error occurred while fetching the data.');
    throw error;
  }
  return res.json();
};

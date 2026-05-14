import { render, screen } from '@testing-library/react';
import App from './App';

test('renders AirChain heading', () => {
  render(<App />);
  const heading = screen.getByText(/AirChain/i);
  expect(heading).toBeInTheDocument();
});

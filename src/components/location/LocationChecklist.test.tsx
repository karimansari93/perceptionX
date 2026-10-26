import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocationChecklist } from './LocationChecklist';
import { buildLocationOptions } from '@/utils/locationContext';

const responses = ['Brazil', 'Mexico', 'India'].map((loc) => ({
  company_id: 'c1',
  confirmed_prompts: { location_context: loc },
}));
const { options } = buildLocationOptions(responses, [{ id: 'c1', country: null }]);

describe('LocationChecklist', () => {
  it('ticks a region as one click and combines markets freely', () => {
    const onChange = vi.fn();
    const { rerender } = render(<LocationChecklist options={options} value={null} onChange={onChange} />);
    expect(screen.getByText('Regions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /Latin America/ }));
    expect(onChange).toHaveBeenLastCalledWith('region:latin-america');

    rerender(<LocationChecklist options={options} value="region:latin-america" onChange={onChange} />);
    expect(screen.getByRole('option', { name: /Brazil/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Mexico/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /India/ })).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('option', { name: /India/ }));
    expect(onChange).toHaveBeenLastCalledWith('set:brazil|india|mexico');

    rerender(<LocationChecklist options={options} value="set:brazil|india|mexico" onChange={onChange} />);
    fireEvent.click(screen.getByRole('option', { name: /All locations/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
